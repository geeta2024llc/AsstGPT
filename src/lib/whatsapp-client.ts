
process.env.WS_NO_BUFFER_UTIL = '1';
process.env.WS_NO_UTF_8_VALIDATE = '1';

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
import { getSupabaseAdmin } from './supabase';
import { runWithRequestContext } from './request-context';
import { generateAIResponse, retrieveRelevantKnowledgeContext, transcribeAudio, type MediaAttachment } from './ai';
import { generateSpeechAudio } from './tts';
import { evaluateHandoffRules, calculateAIConfidence } from './handoff-engine';
import { dispatchWebhookEvent } from './webhook-dispatcher';
import { findDirectFaqMatch, dynamicResponseCache } from './faq-matcher';
import type { Message, Agent } from '@/types';

export const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

/**
 * Returns the sanitized directory path for storing a tenant's WhatsApp session files.
 */
export function getTenantAuthDir(tenantId: string = DEFAULT_TENANT_ID): string {
  if (tenantId === DEFAULT_TENANT_ID || tenantId === 'default') {
    return path.join(process.cwd(), 'whatsapp-auth');
  }
  const cleanId = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(process.cwd(), 'whatsapp-auth', `tenant_${cleanId}`);
}

/**
 * Returns the best-fit Baileys browser descriptor string for the current OS.
 */
function getHostBrowserDescriptor(): [string, string, string] {
  switch (process.platform) {
    case 'win32':
      return Browsers.windows('Desktop');
    case 'linux':
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

export interface AuthStorageHealth {
  authDir: string;
  exists: boolean;
  writable: boolean;
  hasCredentials?: boolean;
  error?: string;
}

export function isConversationPaused(convo?: any): boolean {
  return Boolean(convo && (convo.isBotPaused === true || convo.is_bot_paused === true));
}

const CONNECT_TIMEOUT_MS = 120_000;

// Multi-Tenant global state registry
declare global {
  var whatsappTenantStates: Map<string, WhatsAppClientState> | undefined;
  var whatsappState: WhatsAppClientState | undefined;
  var whatsappWatchdog: NodeJS.Timer | undefined;
}

if (!global.whatsappTenantStates) {
  global.whatsappTenantStates = new Map<string, WhatsAppClientState>();
}

export function getOrCreateTenantState(tenantId: string = DEFAULT_TENANT_ID): WhatsAppClientState {
  let s = global.whatsappTenantStates!.get(tenantId);
  if (!s) {
    s = {
      sock: null,
      status: 'disconnected',
      qr: null,
      account: null,
      lastDisconnect: null,
      connectingSince: null,
      initializing: false,
      reconnectAttempts: 0,
    };
    global.whatsappTenantStates!.set(tenantId, s);
  }
  if (tenantId === DEFAULT_TENANT_ID || tenantId === 'default') {
    global.whatsappState = s;
  }
  return s;
}

// Initialize default state
const defaultState = getOrCreateTenantState(DEFAULT_TENANT_ID);
export const state = defaultState;

const inFlightMessageIds = new Set<string>();
const chatMessageQueues = new Map<string, Promise<void>>();
const consecutiveFallbacksMap = new Map<string, number>();

async function syncTenantChannelMirror(tenantId: string, stateObj: WhatsAppClientState) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    
    // 1. Mirror to whatsapp_connection_state table
    const channelKey = tenantId === DEFAULT_TENANT_ID ? 'default' : tenantId;
    await supabaseAdmin.from('whatsapp_connection_state').upsert({
      channel_id: channelKey,
      status: stateObj.status,
      qr: stateObj.qr,
      account: stateObj.account,
      last_disconnect: stateObj.lastDisconnect,
      connecting_since: stateObj.connectingSince ? new Date(stateObj.connectingSince).toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'channel_id' });

    // 2. Mirror to channels table for tenant isolation
    const { data: channel } = await supabaseAdmin
      .from('channels')
      .select('id, metadata')
      .eq('tenant_id', tenantId)
      .eq('type', 'whatsapp')
      .maybeSingle();

    const existingMeta = (channel?.metadata as Record<string, any>) || {};
    const updatedMeta = {
      ...existingMeta,
      account: stateObj.account,
      phone: stateObj.account?.id?.split(':')[0]?.split('@')[0] || existingMeta.phone,
      qr: stateObj.qr,
      lastDisconnect: stateObj.lastDisconnect,
      updatedAt: new Date().toISOString(),
    };

    if (channel) {
      await supabaseAdmin
        .from('channels')
        .update({
          status: stateObj.status,
          external_account_id: stateObj.account?.id || (stateObj.status === 'connected' ? existingMeta.phone : null),
          display_name: stateObj.account?.name || (stateObj.status === 'connected' ? 'WhatsApp Business' : 'WhatsApp Default'),
          metadata: updatedMeta,
          updated_at: new Date().toISOString(),
        })
        .eq('id', channel.id);
    } else {
      await supabaseAdmin.from('channels').insert({
        tenant_id: tenantId,
        type: 'whatsapp',
        status: stateObj.status,
        external_account_id: stateObj.account?.id || null,
        display_name: stateObj.account?.name || 'WhatsApp Default',
        metadata: updatedMeta,
      });
    }
  } catch (err) {
    console.error(`[SYNC] Failed to mirror WhatsApp state to database for tenant ${tenantId}:`, err);
  }
}

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

async function handleMessage(tenantId: string, msg: WAMessage) {
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
    const { tenantId: resolvedTenantId } = await db.ensureDefaultTenantAndChannel(tenantId);
    const supabaseAdmin = getSupabaseAdmin();
    const { data: tenantRow } = await supabaseAdmin
      .from('tenants')
      .select('is_active')
      .eq('id', resolvedTenantId)
      .maybeSingle();

    if (tenantRow && tenantRow.is_active === false) {
      console.warn(`[SUSPENDED] Inbound WhatsApp message dropped for suspended tenant ${resolvedTenantId}`);
      await db.addLog({
        user: 'System',
        action: 'Inbound Message Dropped',
        details: `Tenant ${resolvedTenantId} is suspended. Inbound message from ${chatId} was halted.`,
        type: 'warning',
      });
      return;
    }

    const tenantState = getOrCreateTenantState(resolvedTenantId);

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
            reuploadRequest: tenantState.sock?.updateMediaMessage as any,
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
            reuploadRequest: tenantState.sock?.updateMediaMessage as any,
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
            reuploadRequest: tenantState.sock?.updateMediaMessage as any,
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

    // 5. Evaluate Automated Pre-Generation Handoff Rules
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
          await sendMessageForTenant(resolvedTenantId, chatId, rule.actions.transitionMessage);
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

    // Step A: Exact/Fuzzy FAQ Match
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

    // Step B: In-Memory Dynamic Response Cache
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

    // Step C: Fall back to Gemini LLM
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
            await sendMessageForTenant(resolvedTenantId, chatId, rule.actions.transitionMessage);
          } catch (sendErr) {
            console.error('Failed to send low-confidence transition message:', sendErr);
          }
        }
        return;
      }
    }

    // Rule-based fallback
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

    const shouldSendVoice = (isVoiceNote || agent.aiSettings?.enableVoiceResponse) && !!responseText;

    try {
      if (shouldSendVoice) {
        console.log(`[MULTIMODAL] Generating voice note response for ${chatId}...`);
        try {
          const audioBuffer = await generateSpeechAudio(responseText, {
            provider: agent.aiSettings?.voiceProvider,
            voice: agent.aiSettings?.voiceName,
          });

          const immediateConvo = await db.getConversation(chatId);
          if (isConversationPaused(immediateConvo)) {
            console.log(`[HANDOFF RACE GUARD] Takeover engaged during TTS generation for ${chatId}. Aborting voice note send.`);
            return;
          }

          await sendVoiceNoteForTenant(resolvedTenantId, chatId, audioBuffer, responseText);
        } catch (ttsErr) {
          console.error('[TTS ERROR] Fallback to text:', ttsErr);
          await sendMessageForTenant(resolvedTenantId, chatId, responseText);
        }
      } else {
        await sendMessageForTenant(resolvedTenantId, chatId, responseText);
      }
    } catch (sendErr) {
      console.error('Failed to dispatch automated response via WhatsApp:', sendErr);
    }
  } catch (error) {
    console.error(`[HANDLE_MESSAGE ERROR] Failed to process message for tenant ${tenantId}:`, error);
  }
}

export async function verifyAndPrepareAuthStorage(authDir: string = getTenantAuthDir(DEFAULT_TENANT_ID)): Promise<AuthStorageHealth> {
  const health: AuthStorageHealth = {
    authDir,
    exists: false,
    writable: false,
  };

  try {
    await fs.mkdir(authDir, { recursive: true });
    health.exists = true;

    const probePath = path.join(authDir, `.probe-${Date.now()}`);
    await fs.writeFile(probePath, 'ok', 'utf-8');
    await fs.unlink(probePath);
    health.writable = true;

    const credsPath = path.join(authDir, 'creds.json');
    try {
      const stat = await fs.stat(credsPath);
      if (stat.size === 0) {
        await fs.unlink(credsPath);
        health.hasCredentials = false;
      } else {
        const content = await fs.readFile(credsPath, 'utf-8');
        JSON.parse(content);
        health.hasCredentials = true;
      }
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        health.hasCredentials = false;
      } else if (err instanceof SyntaxError) {
        await fs.unlink(credsPath).catch(() => {});
        health.hasCredentials = false;
      }
    }
  } catch (err: any) {
    health.error = err?.message || String(err);
  }

  return health;
}

export async function getAuthStorageHealth(tenantId: string = DEFAULT_TENANT_ID): Promise<AuthStorageHealth> {
  return verifyAndPrepareAuthStorage(getTenantAuthDir(tenantId));
}

async function clearAuthDirectory(authDir: string = getTenantAuthDir(DEFAULT_TENANT_ID)) {
  try {
    const files = await fs.readdir(authDir);
    for (const file of files) {
      await fs.rm(path.join(authDir, file), { recursive: true, force: true });
    }
    console.log(`LOGOUT: Session directory contents cleared at ${authDir}`);
  } catch (e: any) {
    if (e?.code !== 'ENOENT') {
      console.error(`LOGOUT: Error clearing session directory contents at ${authDir}:`, e);
    }
  }
}

/**
 * Logs out and clears the WhatsApp session for a specific tenant.
 */
export async function logoutTenant(tenantId: string = DEFAULT_TENANT_ID) {
  const tenantState = getOrCreateTenantState(tenantId);
  const authDir = getTenantAuthDir(tenantId);

  console.log(`LOGOUT: Starting cleanup for workspace "${tenantId}"...`);
  if (tenantState.sock) {
    try {
      await tenantState.sock.logout();
    } catch (e) {
      console.error(`LOGOUT: Error on logout for ${tenantId}:`, e);
    } finally {
      try {
        (tenantState.sock?.ev as any)?.removeAllListeners();
      } catch (_) {}
      tenantState.sock = null;
    }
  }

  await clearAuthDirectory(authDir);

  tenantState.status = 'disconnected';
  tenantState.qr = null;
  tenantState.account = null;
  tenantState.lastDisconnect = null;
  tenantState.connectingSince = null;

  await syncTenantChannelMirror(tenantId, tenantState);
  console.log(`LOGOUT: In-memory & DB state reset for tenant "${tenantId}".`);
}

export async function logout() {
  return logoutTenant(DEFAULT_TENANT_ID);
}

/**
 * Initializes a new WhatsApp connection for a specific tenant.
 */
export async function initTenant(tenantId: string = DEFAULT_TENANT_ID) {
  const tenantState = getOrCreateTenantState(tenantId);
  const authDir = getTenantAuthDir(tenantId);

  if (tenantState.sock || tenantState.initializing) {
    console.log(`INIT: Skipped for tenant ${tenantId}, current status is "${tenantState.status}"`);
    return;
  }
  tenantState.initializing = true;

  console.log(`INIT: Starting WhatsApp connection process for tenant "${tenantId}"...`);
  tenantState.status = 'connecting';
  tenantState.connectingSince = Date.now();
  await syncTenantChannelMirror(tenantId, tenantState);

  try {
    const storageHealth = await verifyAndPrepareAuthStorage(authDir);
    if (!storageHealth.writable) {
      throw new Error(`WhatsApp storage at "${authDir}" is not writable: ${storageHealth.error || 'Permission Denied'}`);
    }

    const { state: authState, saveCreds } = await useMultiFileAuthState(authDir);
    const { version: waVersion } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      logger: pino({ level: 'info' }),
      printQRInTerminal: false,
      auth: authState,
      browser: getHostBrowserDescriptor(),
      markOnlineOnConnect: true,
      connectTimeoutMs: 30_000,
      syncFullHistory: false,
      version: waVersion,
    });

    tenantState.sock = sock;
    tenantState.initializing = false;

    const armConnectTimeout = () => setTimeout(() => {
      console.warn(`INIT: Connection timeout for tenant ${tenantId}, forcing teardown...`);
      sock.end(new Error('Connect timeout: no open/close event received'));
    }, CONNECT_TIMEOUT_MS);
    let connectTimeoutTimer = armConnectTimeout();

    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds();
      } catch (saveErr) {
        console.error(`CRITICAL: Failed to save WhatsApp credentials to disk for tenant ${tenantId}:`, saveErr);
      }
    });

    sock.ev.on('messages.upsert', (update) => {
      for (const msg of update.messages) {
        const jid = msg.key.remoteJid;
        const task = () => runWithRequestContext(
          {
            tenantId,
            userId: '00000000-0000-0000-0000-000000000001',
            userRole: 'admin',
            userEmail: 'system@asstgpt.local',
          },
          () => handleMessage(tenantId, msg)
        );

        if (jid) {
          enqueueChatProcessing(jid, task);
        } else {
          task();
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr: newQr } = update;
      console.log(`CONN_UPDATE [${tenantId}]: status=${connection}, qr=${!!newQr}`);

      if (newQr) {
        tenantState.qr = await qr.toDataURL(newQr);
        tenantState.lastDisconnect = null;
        if (tenantState.status !== 'connected') {
          tenantState.status = 'connecting';
        }
        await syncTenantChannelMirror(tenantId, tenantState);
        clearTimeout(connectTimeoutTimer);
        tenantState.connectingSince = Date.now();
        connectTimeoutTimer = armConnectTimeout();
      }

      if (connection === 'open') {
        clearTimeout(connectTimeoutTimer);
        tenantState.reconnectAttempts = 0;
        tenantState.status = 'connected';
        tenantState.qr = null;
        tenantState.lastDisconnect = null;
        tenantState.connectingSince = null;
        tenantState.account = { id: sock.user!.id, name: sock.user!.name || 'N/A' };
        console.log(`CONN_UPDATE [${tenantId}]: Connection opened successfully.`);
        await syncTenantChannelMirror(tenantId, tenantState);
      }

      if (connection === 'close') {
        clearTimeout(connectTimeoutTimer);
        const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        try {
          (sock.ev as any).removeAllListeners();
        } catch (_) {}

        const reasonString = lastDisconnect?.error?.message || 'Unknown Disconnect';
        tenantState.lastDisconnect = { reason: `Error: ${reasonString}`, date: new Date().toISOString() };

        const shouldReconnect = code !== DisconnectReason.loggedOut && code !== DisconnectReason.connectionReplaced;

        if (shouldReconnect) {
          tenantState.reconnectAttempts++;
          const backoffDelay = Math.min(1000 * Math.pow(1.5, Math.min(tenantState.reconnectAttempts - 1, 8)), 30000) + Math.floor(Math.random() * 1000);
          console.log(`CONN_UPDATE [${tenantId}]: Closed (code=${code}). Reconnecting in ${backoffDelay}ms...`);
          tenantState.status = 'connecting';
          tenantState.sock = null;
          tenantState.account = null;
          await syncTenantChannelMirror(tenantId, tenantState);
          setTimeout(() => {
            initTenant(tenantId).catch((err) => console.error(`Re-init failed for ${tenantId}:`, err));
          }, backoffDelay);
        } else {
          tenantState.reconnectAttempts = 0;
          console.log(`CONN_UPDATE [${tenantId}]: Logged out by server/user (code=${code}). Clearing session.`);
          await clearAuthDirectory(authDir);
          tenantState.status = 'disconnected';
          tenantState.sock = null;
          tenantState.account = null;
          tenantState.connectingSince = null;
          await syncTenantChannelMirror(tenantId, tenantState);
        }
      }
    });
  } catch (error) {
    console.error(`INIT: Failed to establish connection for tenant ${tenantId}:`, error);
    tenantState.sock = null;
    tenantState.status = 'error';
    tenantState.connectingSince = null;
    tenantState.initializing = false;
  }
}

export async function init() {
  return initTenant(DEFAULT_TENANT_ID);
}

// ----------------- Graceful Process Shutdown & Lifecycle -----------------
const isBuilding = process.env.NEXT_PHASE === 'phase-production-build';
const isTestOrScript = typeof process !== 'undefined' && (
  process.env.NODE_ENV === 'test' ||
  process.env.DISABLE_WHATSAPP_AUTO_INIT === '1' ||
  (Array.isArray(process.argv) && process.argv.some(arg => arg.includes('test') || arg.includes('seed_db') || arg.includes('migrate') || arg.includes('check_db')))
);

if (typeof process !== 'undefined' && !isBuilding && !isTestOrScript) {
  const handleGracefulShutdown = async (signal: string) => {
    console.log(`[SHUTDOWN] Received ${signal}. Closing all WhatsApp sockets cleanly...`);
    if (global.whatsappTenantStates) {
      for (const [tId, tState] of global.whatsappTenantStates.entries()) {
        if (tState.sock) {
          try {
            tState.sock.end(new Error(`Graceful shutdown via ${signal}`));
          } catch (err) {
            console.error(`Error closing socket on shutdown for tenant ${tId}:`, err);
          }
        }
      }
    }
  };
  process.once('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
  process.once('SIGINT', () => handleGracefulShutdown('SIGINT'));
}

// ----------------- Watchdog & Auto-Init for Default Tenant -----------------

if (!global.whatsappWatchdog && !isBuilding && !isTestOrScript) {
  global.whatsappWatchdog = setInterval(() => {
    const s = getOrCreateTenantState(DEFAULT_TENANT_ID);
    const stuckConnecting = s.sock && s.status === 'connecting'
      && s.connectingSince !== null
      && Date.now() - s.connectingSince > CONNECT_TIMEOUT_MS;

    if (stuckConnecting) {
      console.warn('WATCHDOG: Default tenant connection stale in "connecting" state, forcing teardown...');
      s.sock!.end(new Error('Watchdog: stale connecting state'));
      return;
    }

    if (!s.sock || s.status !== 'connected') {
      console.warn('WATCHDOG: Socket not connected for default tenant, attempting re-init...');
      initTenant(DEFAULT_TENANT_ID).catch(err => console.error('WATCHDOG: Re-init failed', err));
    }
  }, 30_000);
}

// Trigger initial connection on first import for default workspace
if (defaultState.status === 'disconnected' && !defaultState.sock && !isBuilding && !isTestOrScript) {
  console.log('AUTO_INIT: Starting initial WhatsApp connect for default workspace...');
  initTenant(DEFAULT_TENANT_ID).catch(err => console.error('AUTO_INIT failed:', err));
}

/**
 * Returns tenant-isolated client state for a workspace.
 */
export async function getTenantClientState(tenantId: string = DEFAULT_TENANT_ID): Promise<WhatsAppClientState> {
  const memState = global.whatsappTenantStates?.get(tenantId);
  if (memState && (memState.status === 'connected' || memState.qr || (memState.status === 'connecting' && memState.connectingSince))) {
    return {
      status: memState.status,
      qr: memState.qr,
      account: memState.account,
      lastDisconnect: memState.status === 'connected' ? null : memState.lastDisconnect,
      connectingSince: memState.connectingSince,
      sock: null,
      initializing: memState.initializing,
      reconnectAttempts: memState.reconnectAttempts,
    };
  }

  // Fallback to querying channels table for this tenant
  try {
    const admin = getSupabaseAdmin();
    const { data: channel } = await admin
      .from('channels')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('type', 'whatsapp')
      .maybeSingle();

    if (channel && channel.status === 'connected') {
      const meta = (channel.metadata as Record<string, any>) || {};
      return {
        status: 'connected',
        qr: null,
        account: meta.account || { id: channel.external_account_id || '', name: channel.display_name || 'WhatsApp' },
        lastDisconnect: null,
        connectingSince: null,
        sock: null,
        initializing: false,
        reconnectAttempts: 0,
      };
    }
  } catch (err) {
    console.error(`[STATUS] Error querying channel state for tenant ${tenantId}:`, err);
  }

  return {
    status: memState?.status || 'disconnected',
    qr: memState?.qr || null,
    account: memState?.account || null,
    lastDisconnect: memState?.lastDisconnect || null,
    connectingSince: memState?.connectingSince || null,
    sock: null,
    initializing: memState?.initializing || false,
    reconnectAttempts: memState?.reconnectAttempts || 0,
  };
}

export function getClientState() {
  return {
    status: defaultState.status,
    qr: defaultState.qr,
    account: defaultState.account,
    lastDisconnect: defaultState.status === 'connected' ? null : defaultState.lastDisconnect,
    connectingSince: defaultState.connectingSince,
  };
}

export async function sendMessageForTenant(tenantId: string = DEFAULT_TENANT_ID, to: string, text: string) {
  const tenantState = getOrCreateTenantState(tenantId);
  if (!tenantState.sock || tenantState.status !== 'connected') {
    throw new Error(`WhatsApp client not connected for workspace ${tenantId}.`);
  }
  const sendResult = await tenantState.sock.sendMessage(to, { text });
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

export async function sendMessage(to: string, text: string) {
  return sendMessageForTenant(DEFAULT_TENANT_ID, to, text);
}

export async function sendVoiceNoteForTenant(tenantId: string = DEFAULT_TENANT_ID, to: string, audioBuffer: Buffer, transcriptText?: string) {
  const tenantState = getOrCreateTenantState(tenantId);
  if (!tenantState.sock || tenantState.status !== 'connected') {
    throw new Error(`WhatsApp client not connected for workspace ${tenantId}.`);
  }
  const sendResult = await tenantState.sock.sendMessage(to, {
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

export async function sendVoiceNote(to: string, audioBuffer: Buffer, transcriptText?: string) {
  return sendVoiceNoteForTenant(DEFAULT_TENANT_ID, to, audioBuffer, transcriptText);
}

async function resolveMediaSource(mediaUrl: string): Promise<Buffer | { url: string }> {
  if (mediaUrl.startsWith('/uploads/') || mediaUrl.startsWith('uploads/')) {
    const cleanPath = mediaUrl.startsWith('/') ? mediaUrl.slice(1) : mediaUrl;
    const localFilePath = path.join(process.cwd(), 'public', cleanPath);
    try {
      const buf = await fs.readFile(localFilePath);
      return buf;
    } catch (err) {
      console.warn('Failed to read local media file, falling back to URL:', err);
      return { url: mediaUrl };
    }
  }
  return { url: mediaUrl };
}

export async function sendImageForTenant(
  tenantId: string = DEFAULT_TENANT_ID,
  to: string,
  imageUrl: string,
  caption?: string
) {
  const tenantState = getOrCreateTenantState(tenantId);
  if (!tenantState.sock || tenantState.status !== 'connected') {
    throw new Error(`WhatsApp client not connected for workspace ${tenantId}.`);
  }

  const mediaSource = await resolveMediaSource(imageUrl);
  const payload: any = {
    image: mediaSource,
  };
  if (caption && caption.trim()) {
    payload.caption = caption.trim();
  }

  const sendResult = await tenantState.sock.sendMessage(to, payload);
  const result = (Array.isArray(sendResult) ? sendResult[0] : sendResult) as any;

  const message: Message = {
    id: result.key.id!,
    chatId: to,
    fromMe: true,
    text: caption ? `[Image]: ${caption}` : '[Image]',
    timestamp: Date.now(),
    senderName: 'Me',
    mediaType: 'image',
    mediaCaption: caption || undefined,
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

export async function sendImage(to: string, imageUrl: string, caption?: string) {
  return sendImageForTenant(DEFAULT_TENANT_ID, to, imageUrl, caption);
}

export async function sendVideoForTenant(
  tenantId: string = DEFAULT_TENANT_ID,
  to: string,
  videoUrl: string,
  caption?: string
) {
  const tenantState = getOrCreateTenantState(tenantId);
  if (!tenantState.sock || tenantState.status !== 'connected') {
    throw new Error(`WhatsApp client not connected for workspace ${tenantId}.`);
  }

  const mediaSource = await resolveMediaSource(videoUrl);
  const payload: any = {
    video: mediaSource,
  };
  if (caption && caption.trim()) {
    payload.caption = caption.trim();
  }

  const sendResult = await tenantState.sock.sendMessage(to, payload);
  const result = (Array.isArray(sendResult) ? sendResult[0] : sendResult) as any;

  const message: Message = {
    id: result.key.id!,
    chatId: to,
    fromMe: true,
    text: caption ? `[Video]: ${caption}` : '[Video]',
    timestamp: Date.now(),
    senderName: 'Me',
    mediaType: 'document', // message media type mapping
    mediaCaption: caption || undefined,
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

export async function sendVideo(to: string, videoUrl: string, caption?: string) {
  return sendVideoForTenant(DEFAULT_TENANT_ID, to, videoUrl, caption);
}


