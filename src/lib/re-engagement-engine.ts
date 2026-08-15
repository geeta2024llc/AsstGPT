import {
  getReEngagementConfig,
  getStaleConversationsForReEngagement,
  addMessage,
  updateConversation,
  addLog,
  getMessages,
} from './db';
import { formatContactName } from './format-utils';
import { isCurrentReplicaLeader, enqueueOutboundMessage } from './whatsapp-leader';
import type { Conversation, ReEngagementConfig } from '@/types';

/**
 * Generates a contextual, friendly 1-sentence follow-up check-in using Gemini / Groq.
 */
async function generateContextualFollowUp(
  convo: Conversation,
  defaultTemplate: string
): Promise<string> {
  const customerName = formatContactName(convo.name, convo.id);
  const fallback = defaultTemplate.replace(/\{\{\s*name\s*\}\}/gi, customerName);

  try {
    const messages = await getMessages(convo.id);
    if (!messages || messages.length === 0) return fallback;

    const transcript = messages
      .slice(-5)
      .map(m => `${m.fromMe ? 'Agent' : 'Customer'}: ${m.text}`)
      .join('\n');

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) return fallback;

    const prompt = `You are a polite, helpful customer success agent for AIWhisper.
The customer has been inactive. Generate a 1-sentence, warm and natural follow-up check-in to ask if they need further help.
Customer Name: ${customerName}

Recent Conversation:
${transcript}

Instructions:
- Keep it under 25 words.
- Be friendly, respectful, and never aggressive.
- Output ONLY the message text itself.`;

    const candidateModels = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite'];
    for (const model of candidateModels) {
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.3, maxOutputTokens: 50 },
            }),
            signal: AbortSignal.timeout(4000),
          }
        );

        if (resp.ok) {
          const data = await resp.json();
          const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
          if (text) return text;
        }
      } catch (_) {}
    }

    return fallback;
  } catch (err) {
    return fallback;
  }
}

export interface ReEngagementResult {
  success: boolean;
  isEnabled: boolean;
  scanned: number;
  dispatched: number;
  details: Array<{ chatId: string; customerName: string; message: string }>;
  reason?: string;
}

/**
 * Scans for stale, unanswered conversations and dispatches proactive follow-up messages.
 */
export async function processProactiveReEngagements(
  forceRun = false
): Promise<ReEngagementResult> {
  const config = await getReEngagementConfig();

  if (!config.isEnabled && !forceRun) {
    return {
      success: true,
      isEnabled: false,
      scanned: 0,
      dispatched: 0,
      details: [],
      reason: 'Proactive re-engagement is currently toggled OFF in settings.',
    };
  }

  const staleConvos = await getStaleConversationsForReEngagement(
    config.inactivityHoursThreshold,
    config.maxFollowUpsPerConversation
  );

  const results: Array<{ chatId: string; customerName: string; message: string }> = [];

  for (const convo of staleConvos) {
    try {
      const customerName = formatContactName(convo.name, convo.id);
      let messageText = '';

      if (config.aiGeneratedContextual) {
        messageText = await generateContextualFollowUp(convo, config.followUpMessageTemplate);
      } else {
        messageText = config.followUpMessageTemplate.replace(/\{\{\s*name\s*\}\}/gi, customerName);
      }

      // Add outbound follow-up message to conversation thread
      const msgId = `reengage_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await addMessage({
        id: msgId,
        chatId: convo.id,
        fromMe: true,
        senderName: 'AI Follow-Up',
        text: messageText,
        timestamp: Date.now(),
      });

      // Actually deliver the follow-up to real WhatsApp customers (webchat conversations
      // are already served straight from the DB by the widget, so no dispatch is needed there)
      if (!convo.id.endsWith('@webchat')) {
        try {
          await enqueueOutboundMessage(convo.id, messageText);
        } catch (dispatchErr: any) {
          console.error(`Failed to dispatch re-engagement follow-up to ${convo.id}:`, dispatchErr);
        }
      }

      const currentCount = convo.reEngagementCount || (convo.handoffMetadata?.reEngagementCount as number) || 0;

      // Update conversation state
      await updateConversation(convo.id, {
        reEngagementCount: currentCount + 1,
        lastReEngagementAt: Date.now(),
        handoffMetadata: {
          ...(convo.handoffMetadata || {}),
          reEngagementCount: currentCount + 1,
          lastFollowUpSentAt: Date.now(),
          lastFollowUpMessage: messageText,
        },
      });

      await addLog({
        user: 'Re-Engagement Engine',
        action: 'Proactive Follow-Up Sent',
        details: `Sent auto follow-up #${currentCount + 1} to ${customerName} (${convo.id}): "${messageText.slice(0, 60)}..."`,
        type: 'info',
      });

      results.push({
        chatId: convo.id,
        customerName,
        message: messageText,
      });
    } catch (err: any) {
      console.error(`Failed to dispatch re-engagement for ${convo.id}:`, err);
    }
  }

  return {
    success: true,
    isEnabled: config.isEnabled,
    scanned: staleConvos.length,
    dispatched: results.length,
    details: results,
  };
}

let schedulerTimer: NodeJS.Timeout | null = null;
let lastRunAt = 0;
const SCHEDULER_CHECK_INTERVAL_MS = 60_000;

/**
 * Starts a leader-gated background tick that periodically runs processProactiveReEngagements()
 * without requiring a human to click "Run Now". Safe to call on every replica: only the current
 * WhatsApp leader actually performs a scan each tick, mirroring whatsapp-leader.ts's own heartbeat gating.
 */
export function startReEngagementScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(async () => {
    if (!isCurrentReplicaLeader()) return;
    try {
      const config = await getReEngagementConfig();
      if (!config.isEnabled) return;
      const dueAt = lastRunAt + config.scanIntervalMinutes * 60_000;
      if (Date.now() < dueAt) return;
      lastRunAt = Date.now();
      await processProactiveReEngagements(false);
    } catch (err) {
      console.error('[RE-ENGAGEMENT SCHEDULER] tick failed:', err);
    }
  }, SCHEDULER_CHECK_INTERVAL_MS);
}
