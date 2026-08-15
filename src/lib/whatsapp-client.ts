
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  type WASocket,
  type WAMessage,
  isJidGroup,
  jidNormalizedUser,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import qr from 'qrcode';
import path from 'path';
import fs from 'fs/promises';
import * as db from './db';
import { generateAIResponse, retrieveRelevantKnowledgeContext, transcribeAudio, type MediaAttachment } from './ai';
import { generateSpeechAudio } from './tts';
import { evaluateHandoffRules, calculateAIConfidence } from './handoff-engine';
import { dispatchWebhookEvent } from './webhook-dispatcher';
import { findDirectFaqMatch, dynamicResponseCache } from './faq-matcher';
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

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface WhatsAppClientState {
  sock: WASocket | null;
  status: ConnectionStatus;
  qr: string | null;
  account: { id: string; name: string } | null;
  lastDisconnect: { reason: string; date: string } | null;
  connectingSince: number | null;
  initializing: boolean;
  reconnectAttempts: number;
}

export function isConversationPaused(convo?: any): boolean {
  return Boolean(convo && (convo.isBotPaused === true || convo.is_bot_paused === true));
}

// If a connection attempt hasn't opened (or closed) within this window, treat the
// socket as a zombie and force it closed rather than waiting indefinitely on a
// close event that may never arrive (e.g. a network path that silently
// black-holes the WebSocket instead of erroring).
//
// Raised from 45s to 120s based on production CONN_DIAGNOSTIC evidence: every
// observed teardown had selfInflictedTimeout: true and disconnectStatusCode:
// null — WhatsApp never once sent a real rejection code, we simply killed the
// socket first. Baileys also never emitted a second QR before the old 45s
// timer expired, so a real human scanning a freshly-displayed QR (unlock
// phone, open WhatsApp, navigate to Linked Devices, scan) routinely did not
// finish in time. 120s comfortably covers that without meaningfully
// delaying detection of an actually-dead socket.
const CONNECT_TIMEOUT_MS = 120_000;

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
        initializing: false,
        reconnectAttempts: 0,
    };
}

const state = global.whatsappState;
const inFlightMessageIds = new Set<string>();
const chatMessageQueues = new Map<string, Promise<void>>();
const consecutiveFallbacksMap = new Map<string, number>();

export function enqueueChatProcessing(chatId: string, task: () => Promise<void>): Promise<void> {
  const currentQueue = chatMessageQueues.get(chatId) || Promise.resolve();
  const nextQueue = currentQueue
    .then(() => task())
    .catch((err) => console.error(`[QUEUE ERROR] Error processing queued message for ${chatId}:`, err))
    .finally(() => {
      if (chatMessageQueues.get(chatId) === nextQueue) {
        chatMessageQueues.delete(chatId);
      }
    });
  chatMessageQueues.set(chatId, nextQueue);
  return nextQueue;
}

async function handleMessage(msg: WAMessage) {
  try {
    if (
      !msg.message ||
      !msg.key.remoteJid ||
      isJidGroup(msg.key.remoteJid) ||
      msg.key.remoteJid === 'status@broadcast' ||
      msg.key.remoteJid.endsWith('@broadcast') ||
      msg.key.remoteJid.endsWith('@newsletter')
    ) {
      return;
    }

    const rawJid = msg.key.remoteJid;
    const chatId = jidNormalizedUser(rawJid);
    const providerMessageId = msg.key.id;
    if (!providerMessageId) return;

    // Concurrency Lock: Drop simultaneous duplicate upserts for the same message
    if (inFlightMessageIds.has(providerMessageId)) {
      return;
    }
    inFlightMessageIds.add(providerMessageId);
    setTimeout(() => inFlightMessageIds.delete(providerMessageId), 30_000);

    // Tenant Suspension Check: Halt processing and automated replies if workspace is suspended
    const { tenantId } = await db.ensureDefaultTenantAndChannel();
    const supabaseAdmin = db.getSupabaseAdmin();
    const { data: tenantRow } = await supabaseAdmin
      .from('tenants')
      .select('is_active')
      .eq('id', tenantId)
      .maybeSingle();

    if (tenantRow && tenantRow.is_active === false) {
      console.warn(`[SUSPENDED] Inbound WhatsApp message dropped for suspended tenant ${tenantId}`);
      await db.addLog({
        user: 'System',
        action: 'Inbound Message Dropped',
        details: `Tenant ${tenantId} is suspended. Inbound message from ${chatId} was halted.`,
        type: 'warning',
      });
      return;
    }

    // Extract message content and media attachments
    let messageContent = '';
    let mediaAttachment: MediaAttachment | undefined;
    let isVoiceNote = false;
    let mediaType: 'text' | 'audio' | 'image' | 'document' = 'text';

    if (msg.message.audioMessage) {
      isVoiceNote = true;
      mediaType = 'audio';
      try {
        console.log(`[MULTIMODAL] Downloading inbound voice note from ${chatId}...`);
        const audioBuffer = await downloadMediaMessage(
          msg,
          'buffer',
          {},
          {
            logger: pino({ level: 'silent' }),
            reuploadRequest: state.sock?.updateMediaMessage as any,
          }
        );
        const mimeType = msg.message.audioMessage.mimetype || 'audio/ogg';
        const transcript = await transcribeAudio(audioBuffer as Buffer, mimeType);
        messageContent = transcript ? `[Voice Note]: ${transcript}` : '[Voice Note] (audio received)';
        await db.addLog({
          user: 'System',
          action: 'Voice Note Transcribed',
          details: `From ${chatId}: ${transcript ? transcript.slice(0, 120) : 'empty/unintelligible'}`,
          type: 'info',
        });
      } catch (audioErr) {
        console.error('Audio transcription error:', audioErr);
        messageContent = '[Voice Note] (audio transcription error)';
      }
    } else if (msg.message.imageMessage) {
      mediaType = 'image';
      const caption = msg.message.imageMessage.caption || '';
      messageContent = caption ? `[Image]: ${caption}` : '[Image attached]';
      try {
        console.log(`[MULTIMODAL] Downloading inbound image from ${chatId}...`);
        const imgBuffer = await downloadMediaMessage(
          msg,
          'buffer',
          {},
          {
            logger: pino({ level: 'silent' }),
            reuploadRequest: state.sock?.updateMediaMessage as any,
          }
        );
        mediaAttachment = {
          buffer: imgBuffer as Buffer,
          mimeType: msg.message.imageMessage.mimetype || 'image/jpeg',
        };
        await db.addLog({
          user: 'System',
          action: 'Image Received',
          details: `From ${chatId}: ${caption || 'No caption'} (${(mediaAttachment.buffer.length / 1024).toFixed(1)} KB)`,
          type: 'info',
        });
      } catch (imgErr) {
        console.error('Image download error:', imgErr);
      }
    } else if (msg.message.documentMessage) {
      mediaType = 'document';
      const fileName = msg.message.documentMessage.fileName || 'document';
      const caption = msg.message.documentMessage.caption || '';
      messageContent = `[Document: ${fileName}] ${caption}`.trim();
      try {
        console.log(`[MULTIMODAL] Downloading inbound document from ${chatId}: ${fileName}...`);
        const docBuffer = await downloadMediaMessage(
          msg,
          'buffer',
          {},
          {
            logger: pino({ level: 'silent' }),
            reuploadRequest: state.sock?.updateMediaMessage as any,
          }
        );
        mediaAttachment = {
          buffer: docBuffer as Buffer,
          mimeType: msg.message.documentMessage.mimetype || 'application/pdf',
          fileName,
        };
        await db.addLog({
          user: 'System',
          action: 'Document Received',
          details: `From ${chatId}: ${fileName} (${(mediaAttachment.buffer.length / 1024).toFixed(1)} KB)`,
          type: 'info',
        });
      } catch (docErr) {
        console.error('Document download error:', docErr);
      }
    } else {
      messageContent = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    }

    if (!messageContent && !mediaAttachment) return;

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

    // Derive a sensible sender name.
    const rawName = (msg.pushName || (msg as any).verifiedBizName || '').trim();
    const senderName = rawName && rawName !== '.' && rawName.toLowerCase() !== 'me' ? rawName : chatId.split('@')[0];

    const message: Message = {
      id: providerMessageId,
      chatId,
      fromMe: !!msg.key.fromMe,
      text: messageContent,
      timestamp: (typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : (msg.messageTimestamp as any)?.toNumber?.() || Date.now()/1000) * 1000,
      senderName,
      mediaType,
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

    dispatchWebhookEvent('message.received', {
      id: message.id,
      chatId: message.chatId,
      senderName: message.senderName,
      text: message.text,
      mediaType: message.mediaType,
      timestamp: message.timestamp,
    }).catch(err => console.error('Webhook dispatch error:', err));

    // If message is from me, do not initiate automated agent response pipeline
    if (message.fromMe) return;

    // Auto-reopen conversation if it was previously marked resolved
    const convo = await db.getConversation(chatId);
    if (convo?.status === 'resolved') {
      await db.updateConversation(chatId, { status: 'open' });
      await db.addLog({
        user: 'System',
        action: 'Conversation Reopened',
        details: `Customer ${chatId} sent a new message. Conversation auto-reopened.`,
        type: 'info',
      });
    }

    // 3. Check Manual Pause / Human Takeover Mode
    if (convo && (convo.isBotPaused || convo.assignedAgentId === null || convo.assignedAgentId === '')) {
      console.log(`[HANDOFF] Conversation ${chatId} is in Human Takeover / Paused mode. Skipping AI response.`);
      await db.addLog({
        user: convo.assignedUserId ? `Assigned Agent (${convo.assignedUserId})` : 'Human Operator',
        action: 'AI Response Skipped',
        details: `Conversation ${chatId} is in Human Takeover mode. Reason: ${convo.handoffReason || 'Manual takeover'}. AI auto-reply skipped.`,
        type: 'info',
      });
      return;
    }

    // 4. Fetch Conversation History for Rule Evaluation & Context
    const recentMessages = await db.getMessages(chatId);
    const history = recentMessages
      .filter(m => m.id !== providerMessageId)
      .slice(-6)
      .map(m => ({ fromMe: m.fromMe, text: m.text }));

    const currentFallbacks = consecutiveFallbacksMap.get(chatId) || 0;

    // 5. Evaluate Automated Pre-Generation Handoff Rules (Keywords, Intents, Consecutive Fallbacks)
    const preHandoff = await evaluateHandoffRules({
      messageText: messageContent,
      history,
      consecutiveFallbacks: currentFallbacks,
    });

    if (preHandoff.shouldHandoff && preHandoff.matchedRule) {
      const rule = preHandoff.matchedRule;
      console.log(`[AUTOMATED HANDOFF] Handoff triggered for ${chatId} by rule "${rule.name}". Reason: ${preHandoff.reason}`);

      await db.setConversationTakeover(
        chatId,
        true,
        rule.actions.assignToUserId,
        preHandoff.reason,
        {
          ruleId: rule.id,
          ruleName: rule.name,
          detectedIntent: preHandoff.detectedIntent,
          triggeredAt: new Date().toISOString(),
        }
      );

      dispatchWebhookEvent('handoff.triggered', {
        chatId,
        ruleId: rule.id,
        ruleName: rule.name,
        reason: preHandoff.reason,
        assignedUserId: rule.actions.assignToUserId,
        detectedIntent: preHandoff.detectedIntent,
        timestamp: Date.now(),
      }).catch(err => console.error('Webhook dispatch error:', err));

      await db.addLog({
        user: 'Handoff Engine',
        action: 'Automated Handoff Triggered',
        details: `Rule "${rule.name}" escalated conversation ${chatId}. ${preHandoff.reason}`,
        type: 'warning',
      });

      if (rule.actions.transitionMessage) {
        try {
          await sendMessage(chatId, rule.actions.transitionMessage);
        } catch (sendErr) {
          console.error('Failed to send automated transition message:', sendErr);
        }
      }
      return;
    }

    // 6. Active Agent Configuration
    const agents = await db.getAgents();
    const agent = agents.find((a) => a.id === convo?.assignedAgentId) || agents[0];

    if (!agent) {
      console.error('No agent found to process message for chat:', chatId);
      return;
    }

    // 7. Multi-Tier AI Response Pipeline
    let responseText: string | undefined;
    let ragContextString: string = '';

    // Step A: Exact/Fuzzy FAQ Match ($0.00 cost, <5ms latency)
    if (agent.aiSettings && agent.aiSettings.knowledgeFileIds && agent.aiSettings.knowledgeFileIds.length > 0) {
      const faqMatch = await findDirectFaqMatch(messageContent, agent.aiSettings.knowledgeFileIds);
      if (faqMatch && faqMatch.answer) {
        responseText = faqMatch.answer;
        await db.addLog({
          user: agent.name,
          action: 'FAQ Fast-Path Match',
          details: `Direct answer matched from Q: "${faqMatch.question}" (Source: ${faqMatch.source})`,
          type: 'info',
        });
      }
    }

    // Step B: In-Memory Dynamic Response Cache ($0.00 cost, <1ms latency)
    if (!responseText) {
      const cached = dynamicResponseCache.get(messageContent);
      if (cached) {
        responseText = cached;
        await db.addLog({
          user: agent.name,
          action: 'Dynamic Response Cache Hit',
          details: `Answer retrieved from in-memory cache for query: "${messageContent.slice(0, 50)}"`,
          type: 'info',
        });
      }
    }

    // Step C: Fall back to Gemini LLM only when query is not in FAQ or Cache
    if (!responseText && agent.mode === 'ai' && agent.aiSettings) {
      try {
        const { context: ragContext, sourcesUsed, chunkCount } = await retrieveRelevantKnowledgeContext(messageContent, agent.aiSettings.knowledgeFileIds);
        ragContextString = ragContext;
        if (sourcesUsed.length > 0) {
          await db.addLog({
            user: agent.name,
            action: 'RAG Knowledge Retrieved',
            details: `Retrieved ${chunkCount} relevant chunk(s) from source(s): ${sourcesUsed.join(', ')}.`,
            type: 'info',
          });
        }

        responseText = await generateAIResponse(messageContent, agent.aiSettings, history, mediaAttachment);
        if (responseText) {
          // Cache successful LLM response for repeat inquiries
          if (!mediaAttachment && responseText.length > 5) {
            dynamicResponseCache.set(messageContent, responseText);
          }
          consecutiveFallbacksMap.set(chatId, 0);
          await db.addLog({
            user: agent.name,
            action: 'AI Response Generated',
            details: responseText.slice(0, 120),
            type: 'info',
          });
        }
      } catch (err) {
        console.error('AI response generation failed due to infrastructure error:', err);
        await db.addLog({
          user: agent.name,
          action: 'AI Infrastructure Outage / Error',
          details: (err as Error).message,
          type: 'error',
        });

        // Trigger emergency human handoff for infrastructure failures
        await db.setConversationTakeover(
          chatId,
          true,
          undefined,
          `AI service unavailable / timeout: ${(err as Error).message}`
        );

        responseText = "I am connecting you with one of our human support specialists who will assist you shortly.";
      }
    }

    // 8. Confidence Check & Low-Confidence Handoff Guardrail
    if (responseText) {
      const confidenceScore = calculateAIConfidence(responseText, messageContent, ragContextString);
      const confHandoff = await evaluateHandoffRules({
        messageText: messageContent,
        history,
        currentConfidence: confidenceScore,
        consecutiveFallbacks: currentFallbacks,
      });

      if (confHandoff.shouldHandoff && confHandoff.matchedRule) {
        const rule = confHandoff.matchedRule;
        console.log(`[AUTOMATED HANDOFF] Low confidence handoff triggered for ${chatId}. Score: ${(confidenceScore * 100).toFixed(0)}%`);

        await db.setConversationTakeover(
          chatId,
          true,
          rule.actions.assignToUserId,
          confHandoff.reason,
          {
            ruleId: rule.id,
            ruleName: rule.name,
            confidence: confidenceScore,
            triggeredAt: new Date().toISOString(),
          }
        );

        dispatchWebhookEvent('handoff.triggered', {
          chatId,
          ruleId: rule.id,
          ruleName: rule.name,
          reason: confHandoff.reason,
          confidence: confidenceScore,
          assignedUserId: rule.actions.assignToUserId,
          timestamp: Date.now(),
        }).catch(err => console.error('Webhook dispatch error:', err));

        await db.addLog({
          user: 'Handoff Engine',
          action: 'Automated Handoff Triggered (Low Confidence)',
          details: confHandoff.reason || `Low confidence score of ${(confidenceScore * 100).toFixed(0)}%`,
          type: 'warning',
        });

        if (rule.actions.transitionMessage) {
          try {
            await sendMessage(chatId, rule.actions.transitionMessage);
          } catch (sendErr) {
            console.error('Failed to send low-confidence transition message:', sendErr);
          }
        }
        return;
      }
    }

    // Rule-based fallback if not AI mode or if AI response returned empty
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
        consecutiveFallbacksMap.set(chatId, currentFallbacks + 1);
      } else {
        consecutiveFallbacksMap.set(chatId, 0);
      }
    }

    // Pre-Send Guard: Re-check if human agent engaged takeover while AI was generating
    const latestConvo = await db.getConversation(chatId);
    if (isConversationPaused(latestConvo)) {
      console.log(`[HANDOFF RACE GUARD] Takeover engaged during generation for ${chatId}. Aborting auto-response send.`);
      await db.addLog({
        user: latestConvo?.assignedUserId ? `Assigned Agent (${latestConvo.assignedUserId})` : 'Human Operator',
        action: 'AI Response Aborted (Takeover Engaged)',
        details: `Human operator took over conversation ${chatId} while AI was generating. Outbound message dropped.`,
        type: 'info',
      });
      return;
    }

    // 5. Send Outbound Response via WhatsApp & Persist to Supabase
    // If incoming message was a voice note OR if agent has voice responses enabled, reply with voice note
    const shouldSendVoice = (isVoiceNote || agent.aiSettings?.enableVoiceResponse) && !!responseText;

    try {
      if (shouldSendVoice) {
        console.log(`[MULTIMODAL] Generating voice note response for ${chatId}...`);
        try {
          const audioBuffer = await generateSpeechAudio(responseText, {
            provider: agent.aiSettings?.voiceProvider,
            voice: agent.aiSettings?.voiceName,
          });

          // Second Guard: Check immediately before irreversible socket dispatch (post-TTS generation)
          const immediateConvo = await db.getConversation(chatId);
          if (isConversationPaused(immediateConvo)) {
            console.log(`[HANDOFF RACE GUARD] Takeover engaged during TTS generation for ${chatId}. Aborting voice note send.`);
            return;
          }

          await sendVoiceNote(chatId, audioBuffer, responseText);
          await db.addLog({
            user: agent.name,
            action: 'Auto-response Sent (Voice Note)',
            details: responseText.slice(0, 120),
            type: 'success',
          });
        } catch (ttsErr) {
          console.warn('Voice response generation failed, falling back to text:', ttsErr);
          const fallbackConvo = await db.getConversation(chatId);
          if (isConversationPaused(fallbackConvo)) {
            console.log(`[HANDOFF RACE GUARD] Takeover engaged during TTS failure for ${chatId}. Aborting fallback text send.`);
            return;
          }

          await sendMessage(chatId, responseText);
          await db.addLog({
            user: agent.name,
            action: 'Auto-response Sent (Text Fallback)',
            details: responseText.slice(0, 120),
            type: 'success',
          });
        }
      } else {
        // Immediate pre-send check before text socket dispatch
        const immediateConvo = await db.getConversation(chatId);
        if (isConversationPaused(immediateConvo)) {
          console.log(`[HANDOFF RACE GUARD] Takeover engaged before text dispatch for ${chatId}. Aborting message send.`);
          return;
        }

        await sendMessage(chatId, responseText);
        await db.addLog({
          user: agent.name,
          action: 'Auto-response Sent',
          details: responseText.slice(0, 120),
          type: 'success',
        });
      }
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

export interface AuthStorageHealth {
  directory: string;
  exists: boolean;
  writable: boolean;
  hasCredentials: boolean;
  error: string | null;
}

/**
 * Validates and prepares the auth storage directory.
 * - Ensures the target directory exists.
 * - Tests write/read/unlink permissions safely using a transient probe file.
 * - Detects and cleans up empty (0-byte) or corrupt creds.json files to ensure self-healing.
 */
export async function verifyAndPrepareAuthStorage(): Promise<AuthStorageHealth> {
  const health: AuthStorageHealth = {
    directory: WHATSAPP_AUTH_DIR,
    exists: false,
    writable: false,
    hasCredentials: false,
    error: null,
  };

  try {
    await fs.mkdir(WHATSAPP_AUTH_DIR, { recursive: true });
    health.exists = true;

    // Test write permission with a lightweight probe file
    const probePath = path.join(WHATSAPP_AUTH_DIR, `.probe-${Date.now()}`);
    await fs.writeFile(probePath, 'ok', 'utf-8');
    await fs.unlink(probePath);
    health.writable = true;

    const credsPath = path.join(WHATSAPP_AUTH_DIR, 'creds.json');
    try {
      const stat = await fs.stat(credsPath);
      if (stat.size === 0) {
        console.warn('STORAGE_CHECK: Detected 0-byte corrupt creds.json, clearing to allow clean pairing...');
        await fs.unlink(credsPath);
        health.hasCredentials = false;
      } else {
        // Sanity check JSON readability
        const content = await fs.readFile(credsPath, 'utf-8');
        JSON.parse(content);
        health.hasCredentials = true;
      }
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        health.hasCredentials = false;
      } else if (err instanceof SyntaxError) {
        console.warn('STORAGE_CHECK: Detected malformed JSON in creds.json, clearing to allow clean recovery...');
        await fs.unlink(credsPath).catch(() => {});
        health.hasCredentials = false;
      } else {
        console.warn('STORAGE_CHECK: Error inspecting creds.json:', err);
      }
    }
  } catch (err: any) {
    console.error('STORAGE_CHECK: Failed storage permission or access check for WHATSAPP_AUTH_DIR:', err);
    health.error = err?.message || String(err);
  }

  return health;
}

export async function getAuthStorageHealth(): Promise<AuthStorageHealth> {
  return verifyAndPrepareAuthStorage();
}

/**
 * Safely clears all auth state files inside WHATSAPP_AUTH_DIR.
 * Deletes file contents instead of deleting the directory itself, because when
 * WHATSAPP_AUTH_DIR is a mounted Docker volume (e.g. on Railway), rmdir on the
 * mount point fails with EACCES / EBUSY.
 */
async function clearAuthDirectory() {
  try {
    const files = await fs.readdir(WHATSAPP_AUTH_DIR);
    for (const file of files) {
      await fs.rm(path.join(WHATSAPP_AUTH_DIR, file), { recursive: true, force: true });
    }
    console.log('LOGOUT: Session directory contents cleared.');
  } catch (e: any) {
    if (e?.code !== 'ENOENT') {
      console.error('LOGOUT: Error clearing session directory contents.', e);
    }
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
  
  await clearAuthDirectory();

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
  //
  // `state.initializing` is set synchronously below, before any await, so it
  // closes the race that `state.sock` alone cannot: state.sock is only
  // assigned after two real I/O operations (useMultiFileAuthState,
  // fetchLatestBaileysVersion), and a second init() call — from the
  // watchdog, from POST /api/whatsapp/init, or from a reconnect — landing in
  // that gap would previously slip past the state.sock check and create a
  // second live Baileys socket against the same auth directory.
  if (state.sock || state.initializing) {
    console.log(`INIT: Skipped, current status is "${state.status}"`);
    return;
  }
  state.initializing = true;

  console.log('INIT: Starting connection process...');
  state.status = 'connecting';
  state.connectingSince = Date.now();

  try {
    // 1. Verify filesystem write permissions and heal any corrupt 0-byte credentials
    const storageHealth = await verifyAndPrepareAuthStorage();
    if (!storageHealth.writable) {
      throw new Error(`WhatsApp storage at "${WHATSAPP_AUTH_DIR}" is not writable: ${storageHealth.error || 'Permission Denied'}`);
    }

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
    // The socket now exists, so the `state.sock` check in the guard above is
    // sufficient on its own again; release the synchronous guard.
    state.initializing = false;

    // Belt-and-suspenders on top of connectTimeoutMs: if the connection hasn't
    // reached 'open' (or 'close') within CONNECT_TIMEOUT_MS, force it closed so
    // the socket can never sit as a zombie in state.sock while status stays
    // stuck at 'connecting' forever (that state previously made the watchdog's
    // recovery attempts permanently no-ops, since init() bails out whenever
    // state.sock is set).
    const armConnectTimeout = () => setTimeout(() => {
        console.warn(`INIT: Connection did not open within ${CONNECT_TIMEOUT_MS}ms, forcing teardown...`);
        sock.end(new Error('Connect timeout: no open/close event received'));
    }, CONNECT_TIMEOUT_MS);
    let connectTimeoutTimer = armConnectTimeout();

    // Attach event listeners with error-boundary protection around disk writes
    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds();
      } catch (saveErr) {
        console.error('CRITICAL: Failed to save WhatsApp credentials to disk:', saveErr);
      }
    });

    sock.ev.on('messages.upsert', (update) => {
      for (const msg of update.messages) {
        const jid = msg.key.remoteJid;
        if (jid) {
          enqueueChatProcessing(jid, () => handleMessage(msg));
        } else {
          handleMessage(msg);
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr: newQr, isNewLogin, receivedPendingNotifications } = update;
      console.log(`CONN_UPDATE: status=${connection}, qr=${!!newQr}`);

      // Structured, secret-free diagnostic snapshot of the QR-scan -> paired
      // transition. Never logs QR contents, credentials, or phone numbers —
      // only connection-state metadata and, on close, the disconnect's real
      // Boom status code/name so a genuine WhatsApp-side rejection can be
      // told apart from our own synthetic connect-timeout teardown (which
      // surfaces as a plain Error with no statusCode, i.e. disconnectStatusCode: null).
      const disconnectErr = lastDisconnect?.error as (Boom | Error | undefined);
      const disconnectStatusCode = (disconnectErr as Boom | undefined)?.output?.statusCode ?? null;
      const selfInflicted = disconnectErr?.message === 'Connect timeout: no open/close event received'
        || disconnectErr?.message === 'Watchdog: stale connecting state';
      console.log('CONN_DIAGNOSTIC ' + JSON.stringify({
        connection: connection ?? null,
        hasQr: !!newQr,
        isNewLogin: isNewLogin ?? null,
        receivedPendingNotifications: receivedPendingNotifications ?? null,
        disconnectStatusCode,
        disconnectErrorName: disconnectErr?.name ?? null,
        disconnectErrorMessage: disconnectErr?.message ?? null,
        selfInflictedTimeout: selfInflicted,
      }));

      if (newQr) {
          state.qr = await qr.toDataURL(newQr);
          if (state.status !== 'connected') {
              // Only go to connecting if we aren't already connected
              state.status = 'connecting';
          }
          // A QR was successfully issued, proving the socket is alive (not a
          // zombie handshake). Re-arm the teardown timer from this point so the
          // user gets a full CONNECT_TIMEOUT_MS window to scan it, instead of
          // being judged against a clock that started when init() first ran
          // (before this QR — or any QR — existed).
          clearTimeout(connectTimeoutTimer);
          state.connectingSince = Date.now();
          connectTimeoutTimer = armConnectTimeout();
      }

      if (connection === 'open') {
          clearTimeout(connectTimeoutTimer);
          state.reconnectAttempts = 0;
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
              state.reconnectAttempts++;
              const backoffDelay = Math.min(1000 * Math.pow(1.5, Math.min(state.reconnectAttempts - 1, 8)), 30000) + Math.floor(Math.random() * 1000);
              console.log(`CONN_UPDATE: Connection closed (code=${code}). Attempting automatic reconnect (#${state.reconnectAttempts}) in ${backoffDelay}ms...`);
              // Notify UI that we're attempting to restore the session
              state.status = 'connecting';
              state.sock = null;
              state.account = null;
              // Exponential backoff with jitter
              setTimeout(() => {
                  init().catch((err) => console.error('Re-init failed:', err));
              }, backoffDelay);
          } else {
              // code is loggedOut (401) or connectionReplaced (440): WhatsApp has
              // invalidated this session server-side.
              state.reconnectAttempts = 0;
              console.log(`CONN_UPDATE: Logged out by user/device (code=${code}). Clearing stale session and waiting for fresh QR rescan.`);
              await clearAuthDirectory();
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
    state.initializing = false;
  }
}

// ----------------- Graceful Process Shutdown & Lifecycle -----------------
const isBuilding = process.env.NEXT_PHASE === 'phase-production-build';

if (typeof process !== 'undefined' && !isBuilding) {
    const handleGracefulShutdown = async (signal: string) => {
        console.log(`[SHUTDOWN] Received ${signal}. Closing WhatsApp socket cleanly...`);
        if (state.sock) {
            try {
                state.sock.end(new Error(`Graceful shutdown via ${signal}`));
            } catch (err) {
                console.error('Error closing socket on shutdown:', err);
            }
        }
    };
    process.once('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
    process.once('SIGINT', () => handleGracefulShutdown('SIGINT'));
}

// ----------------- Watchdog & Auto-Init -----------------

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
        mediaType: 'text',
    };

    await db.addMessage(message);
    const existingConvo = await db.getConversation(to);
    const updates: any = {
      lastMessage: { text: message.text, timestamp: message.timestamp },
      unreadCount: 0,
    };
    if (existingConvo && !existingConvo.firstResponseTimeMs && existingConvo.lastMessage?.timestamp) {
      updates.firstResponseTimeMs = Math.max(0, Date.now() - existingConvo.lastMessage.timestamp);
    }
    await db.updateConversation(to, updates);
    await db.incrementStat('sent');

    return result;
}

export async function sendVoiceNote(to: string, audioBuffer: Buffer, transcriptText?: string) {
    if (!state.sock || state.status !== 'connected') {
        throw new Error('WhatsApp client not connected.');
    }
    const sendResult = await state.sock.sendMessage(to, {
        audio: audioBuffer,
        mimetype: 'audio/mp4',
        ptt: true,
    });
    const result = (Array.isArray(sendResult) ? sendResult[0] : sendResult) as any;

    const message: Message = {
        id: result.key.id!,
        chatId: to,
        fromMe: true,
        text: transcriptText ? `[Voice Note]: ${transcriptText}` : '[Voice Note]',
        timestamp: Date.now(),
        senderName: 'Me',
        mediaType: 'audio',
    };

    await db.addMessage(message);
    const existingConvo = await db.getConversation(to);
    const updates: any = {
      lastMessage: { text: message.text, timestamp: message.timestamp },
      unreadCount: 0,
    };
    if (existingConvo && !existingConvo.firstResponseTimeMs && existingConvo.lastMessage?.timestamp) {
      updates.firstResponseTimeMs = Math.max(0, Date.now() - existingConvo.lastMessage.timestamp);
    }
    await db.updateConversation(to, updates);
    await db.incrementStat('sent');

    return result;
}

