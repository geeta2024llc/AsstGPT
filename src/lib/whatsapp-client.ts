
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  type WASocket,
  type WAMessage,
  isJidGroup,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import qr from 'qrcode';
import path from 'path';
import fs from 'fs/promises';
import * as db from './db';
import { generateAIResponse, retrieveRelevantKnowledgeContext } from './ai';
import type { Message, Agent } from '@/types';

const WHATSAPP_AUTH_DIR = path.join(process.cwd(), 'whatsapp-auth');

/**
 * Returns the best-fit Baileys browser descriptor string for the current OS.
 * This is purely metadata WhatsApp uses for analytics — choose something
 * plausible so that connections from Linux/Windows servers do not raise
 * suspicion.
 */
function getHostBrowserDescriptor(): [string, string, string] {
  switch (process.platform) {
    case 'win32':
      return Browsers.windows('Desktop');
    case 'linux':
      // "Ubuntu" is acceptable for the vast majority of server deployments
      return Browsers.ubuntu('Desktop');
    case 'darwin':
    default:
      return Browsers.macOS('Desktop');
  }
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface WhatsAppClientState {
  sock: WASocket | null;
  status: ConnectionStatus;
  qr: string | null;
  account: { id: string; name: string } | null;
  lastDisconnect: { reason: string; date: string } | null;
  connectingSince: number | null;
}

// If a connection attempt hasn't opened (or closed) within this window, treat the
// socket as a zombie and force it closed rather than waiting indefinitely on a
// close event that may never arrive (e.g. a network path that silently
// black-holes the WebSocket instead of erroring).
const CONNECT_TIMEOUT_MS = 45_000;

// Use a simple global object for state management in Next.js dev environment
declare global {
  var whatsappState: WhatsAppClientState;
  var whatsappWatchdog: NodeJS.Timer | undefined;
}

// Initialize the global state if it doesn't exist
if (!global.whatsappState) {
    global.whatsappState = {
        sock: null,
        status: 'disconnected',
        qr: null,
        account: null,
        lastDisconnect: null,
        connectingSince: null,
    };
}

const state = global.whatsappState;

async function handleMessage(msg: WAMessage) {
  try {
    if (!msg.message || !msg.key.remoteJid || isJidGroup(msg.key.remoteJid)) {
      return;
    }

    const chatId = msg.key.remoteJid;
    const providerMessageId = msg.key.id;
    const messageContent = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    if (!messageContent || !providerMessageId) return;

    // 1. Idempotency Check: Skip duplicate events emitted by Baileys
    const isDuplicate = await db.hasMessage(providerMessageId);
    if (isDuplicate) {
      await db.addLog({
        user: 'System',
        action: 'Duplicate Message Skipped',
        details: `Message ${providerMessageId} from ${chatId} was already processed.`,
        type: 'info',
      });
      return;
    }

    // Derive a sensible sender name. Sometimes WhatsApp supplies pushName as a single '.' or empty string.
    const rawName = (msg.pushName || '').trim();
    const senderName = rawName && rawName !== '.' ? rawName : chatId.split('@')[0];

    const message: Message = {
      id: providerMessageId,
      chatId,
      fromMe: !!msg.key.fromMe,
      text: messageContent,
      timestamp: (typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : (msg.messageTimestamp as any)?.toNumber?.() || Date.now()/1000) * 1000,
      senderName,
    };

    // 2. Persist Inbound Message to Supabase (Atomic DB Idempotency)
    const addResult = await db.addMessage(message);
    if (addResult.duplicate) {
      console.log(`[DIAGNOSTIC] Duplicate message skipped by atomic DB constraint: ${providerMessageId}`);
      await db.addLog({
        user: 'System',
        action: 'Duplicate Message Skipped',
        details: `Message ${providerMessageId} from ${chatId} was rejected as duplicate by database constraint.`,
        type: 'info',
      });
      return;
    }

    console.log(`[DIAGNOSTIC] Inbound message persisted: ${providerMessageId} from ${chatId}`);
    await db.addLog({
      user: senderName,
      action: 'WhatsApp Message Received',
      details: `From ${chatId}: ${messageContent.slice(0, 100)}`,
      type: 'info',
    });

    // If message is from me, do not initiate automated agent response pipeline
    if (message.fromMe) return;

    // 3. Agent Selection Logic
    let agent: Agent | undefined;
    const convo = await db.getConversation(chatId);
    if (convo && (convo.assignedAgentId === null || convo.assignedAgentId === '')) {
      console.log(`[HANDOFF] Conversation ${chatId} is currently assigned to Human Operator. Skipping AI response.`);
      await db.addLog({
        user: 'Human Operator',
        action: 'AI Response Skipped',
        details: `Conversation ${chatId} is in Human Takeover mode. AI auto-reply skipped.`,
        type: 'info',
      });
      return;
    }

    if (convo?.assignedAgentId) {
      agent = await db.getAgent(convo.assignedAgentId);
    }
    if (!agent) {
      const agents = await db.getAgents();
      agent = agents.find((a) => a.status === 'active') || agents[0];
      if (agent) {
        await db.setConversationAssignedAgent(chatId, agent.id);
      }
    }

    if (!agent) {
      console.warn(`No agent available to respond to conversation ${chatId}.`);
      await db.addLog({
        user: 'System',
        action: 'No Agent Available',
        details: `No active agent found to handle message from ${chatId}.`,
        type: 'warning',
      });
      return;
    }

    await db.addLog({
      user: agent.name,
      action: 'Agent Selected',
      details: `Selected agent "${agent.name}" (mode: ${agent.mode}) for ${chatId}`,
      type: 'info',
    });

    // 4. AI or Rule-Based Response Pipeline
    let responseText: string | undefined;

    if (agent.mode === 'ai' && agent.aiSettings) {
      try {
        const recentMessages = await db.getMessages(chatId);
        const history = recentMessages
          .filter(m => m.id !== providerMessageId)
          .slice(-6)
          .map(m => ({ fromMe: m.fromMe, text: m.text }));

        const { context: ragContext, sourcesUsed, chunkCount } = await retrieveRelevantKnowledgeContext(messageContent, agent.aiSettings.knowledgeFileIds);
        if (sourcesUsed.length > 0) {
          await db.addLog({
            user: agent.name,
            action: 'RAG Knowledge Retrieved',
            details: `Retrieved ${chunkCount} relevant chunk(s) from source(s): ${sourcesUsed.join(', ')}. Context size: ${ragContext.length} chars.`,
            type: 'info',
          });
        }

        responseText = await generateAIResponse(messageContent, agent.aiSettings, history);
        if (responseText) {
          await db.addLog({
            user: agent.name,
            action: 'AI Response Generated',
            details: responseText.slice(0, 120),
            type: 'info',
          });
        }
      } catch (err) {
        console.error('AI response generation failed:', err);
        await db.addLog({
          user: agent.name,
          action: 'AI Response Failed',
          details: (err as Error).message,
          type: 'error',
        });
      }
    }

    // Rule-based fallback if not AI mode or if AI response failed / returned empty
    if (!responseText) {
      const lowerText = messageContent.toLowerCase();
      for (const rule of agent.rules) {
        const keywords = rule.trigger.value.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
        if (keywords.length && keywords.some((kw) => lowerText.includes(kw))) {
          responseText = rule.responses.length > 0
            ? rule.responses[Math.floor(Math.random() * rule.responses.length)]
            : undefined;
          break;
        }
      }
      if (!responseText) {
        responseText = agent.fallbackResponse || "Sorry, I didn't quite understand that.";
      }
    }

    // 5. Send Outbound Response via WhatsApp & Persist to Supabase
    try {
      await sendMessage(chatId, responseText);
      await db.addLog({
        user: agent.name,
        action: 'Auto-response Sent',
        details: responseText.slice(0, 120),
        type: 'success',
      });
    } catch (sendErr) {
      console.error('Failed to send auto-response:', sendErr);
      await db.addLog({
        user: agent.name,
        action: 'Auto-response Failed',
        details: (sendErr as Error).message,
        type: 'error',
      });
    }
  } catch (error) {
    console.error('Error handling WhatsApp message:', error);
    try {
      await db.addLog({
        user: 'System',
        action: 'Message Processing Failed',
        details: (error as Error).message,
        type: 'error',
      });
    } catch (_) {/* ignore logging failure to avoid crash loop */}
  }
}

/**
 * Forcefully disconnects, cleans up listeners, and deletes session files.
 * This is the "nuke" option for a guaranteed clean slate.
 */
export async function logout() {
  console.log('LOGOUT: Starting full cleanup...');
  if (state.sock) {
    console.log('LOGOUT: Logging out of existing socket.');
    try {
      // It's possible the socket is already dead, so we wrap this
      await state.sock.logout();
    } catch (e) {
      console.error('LOGOUT: Error on logout, probably already disconnected.', e);
    } finally {
      // This is crucial to prevent memory leaks and ghost processes
      (state.sock?.ev as any)?.removeAllListeners();
      state.sock = null;
    }
  }
  
  try {
    await fs.rm(WHATSAPP_AUTH_DIR, { recursive: true, force: true });
    console.log('LOGOUT: Session directory deleted.');
  } catch (e) {
    console.error('LOGOUT: Error deleting session directory.', e);
  }

  // Reset in-memory state
  state.status = 'disconnected';
  state.qr = null;
  state.account = null;
  console.log('LOGOUT: In-memory state has been reset.');
}

/**
 * Initializes a new WhatsApp connection.
 * It attempts to use an existing session if available.
 */
export async function init() {
  // If a connection is already open or in progress, do nothing.
  // The UI should call logout() first if it wants a fresh start.
  // If a socket connection already exists, avoid creating another.
  if (state.sock) {
    console.log(`INIT: Skipped, current status is "${state.status}"`);
    return;
  }
  
  console.log('INIT: Starting connection process...');
  state.status = 'connecting';
  state.connectingSince = Date.now();

  try {
    const { state: authState, saveCreds } = await useMultiFileAuthState(WHATSAPP_AUTH_DIR);

    // Ensure we're always using the latest WhatsApp Web version to avoid 515 errors
    const { version: waVersion } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        logger: pino({ level: 'info' }),
        printQRInTerminal: false,
        auth: authState,
              // Choose a browser descriptor appropriate to the host OS so the code works
        // identically on macOS, Linux & Windows deployments.
        browser: getHostBrowserDescriptor(),
        markOnlineOnConnect: true,
        connectTimeoutMs: 30_000,
        syncFullHistory: false,
        version: waVersion,
    });

    state.sock = sock;

    // Belt-and-suspenders on top of connectTimeoutMs: if the connection hasn't
    // reached 'open' (or 'close') within CONNECT_TIMEOUT_MS, force it closed so
    // the socket can never sit as a zombie in state.sock while status stays
    // stuck at 'connecting' forever (that state previously made the watchdog's
    // recovery attempts permanently no-ops, since init() bails out whenever
    // state.sock is set).
    const connectTimeoutTimer = setTimeout(() => {
        console.warn(`INIT: Connection did not open within ${CONNECT_TIMEOUT_MS}ms, forcing teardown...`);
        sock.end(new Error('Connect timeout: no open/close event received'));
    }, CONNECT_TIMEOUT_MS);

    // Attach event listeners
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', (update) => {
      for (const msg of update.messages) {
        handleMessage(msg);
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr: newQr } = update;
      console.log(`CONN_UPDATE: status=${connection}, qr=${!!newQr}`);

      if (newQr) {
          state.qr = await qr.toDataURL(newQr);
          if (state.status !== 'connected') {
              // Only go to connecting if we aren't already connected
              state.status = 'connecting';
          }
      }

      if (connection === 'open') {
          clearTimeout(connectTimeoutTimer);
          state.status = 'connected';
          state.qr = null;
          state.connectingSince = null;
          state.account = { id: sock.user!.id, name: sock.user!.name || 'N/A' };
          console.log('CONN_UPDATE: Connection opened successfully.');
      }

      if (connection === 'close') {
          clearTimeout(connectTimeoutTimer);
          const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
          // Cleanly remove all listeners from this socket to avoid duplicate events during reconnect
          try {
              // removeAllListeners typing mismatch in Baileys; cast to any to avoid TS error
              (sock.ev as any).removeAllListeners();
          } catch (_) {/* ignore */}

          const reasonString = lastDisconnect?.error?.message || 'Unknown Disconnect';
          state.lastDisconnect = { reason: `Error: ${reasonString}`, date: new Date().toISOString() };

          // Reconnect automatically for all reasons except an explicit logout
          // Avoid reconnect loop if our session was replaced elsewhere (code 440)
          const shouldReconnect = code !== DisconnectReason.loggedOut && code !== DisconnectReason.connectionReplaced;

          if (shouldReconnect) {
              console.log(`CONN_UPDATE: Connection closed (code=${code}). Attempting automatic reconnect...`);
              // Notify UI that we're attempting to restore the session
              state.status = 'connecting';
              state.sock = null;
              state.account = null;
              // Give WhatsApp a short breather before trying again
              setTimeout(() => {
                  init().catch((err) => console.error('Re-init failed:', err));
              }, 1000);
          } else {
              console.log(`CONN_UPDATE: Logged out by user/device (code=${code}). Waiting for QR rescan.`);
              state.status = 'disconnected';
              state.sock = null;
              state.account = null;
              state.connectingSince = null;
          }
      }
    });
  } catch (error) {
    console.error('INIT: Failed to establish connection', error);
    state.sock = null;
    state.status = 'error';
    state.connectingSince = null;
  }
}

// ----------------- Watchdog & Auto-Init -----------------
const isBuilding = process.env.NEXT_PHASE === 'phase-production-build';

if (!global.whatsappWatchdog && !isBuilding) {
    global.whatsappWatchdog = setInterval(() => {
        const stuckConnecting = state.sock && state.status === 'connecting'
            && state.connectingSince !== null
            && Date.now() - state.connectingSince > CONNECT_TIMEOUT_MS;

        if (stuckConnecting) {
            // init()'s own CONNECT_TIMEOUT_MS timer should already have torn this
            // down; this is the fallback in case that timer was itself lost (e.g.
            // dev-mode hot reload). Force it closed via end() so it goes through
            // the normal connection.update('close') cleanup + reconnect path.
            console.warn('WATCHDOG: Connection stale in "connecting" state, forcing teardown...');
            state.sock!.end(new Error('Watchdog: stale connecting state'));
            return;
        }

        if (!state.sock || state.status !== 'connected') {
            console.warn('WATCHDOG: Socket not connected, attempting re-init...');
            init().catch(err => console.error('WATCHDOG: Re-init failed', err));
        }
    }, 30_000);
}

// Trigger initial connection on first import (runtime only, skipped during build)
if (state.status === 'disconnected' && !state.sock && !isBuilding) {
    console.log('AUTO_INIT: No active socket, starting initial WhatsApp connect...');
    init().catch(err => console.error('AUTO_INIT failed:', err));
}

export function getClientState() {
  return {
    status: state.status,
    qr: state.qr,
    account: state.account,
    lastDisconnect: state.lastDisconnect,
    connectingSince: state.connectingSince,
  };
}

export async function sendMessage(to: string, text: string) {
    if (!state.sock || state.status !== 'connected') {
        throw new Error('WhatsApp client not connected.');
    }
    const sendResult = await state.sock.sendMessage(to, { text });
    // Baileys types changed: sendMessage may return object or array
    const result = (Array.isArray(sendResult) ? sendResult[0] : sendResult) as any;
    
    const message: Message = {
        id: result.key.id!,
        chatId: to,
        fromMe: true,
        text: text,
        timestamp: Date.now(),
        senderName: 'Me',
    };

    await db.addMessage(message);
    await db.updateConversation(to, {
        lastMessage: { text: message.text, timestamp: message.timestamp },
        unreadCount: 0,
    });
    await db.incrementStat('sent');

    return result;
}
