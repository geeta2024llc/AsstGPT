import { NextResponse } from 'next/server';
import crypto from 'crypto';
import * as db from '@/lib/db';
import { runWithRequestContext } from '@/lib/request-context';
import { getSupabaseAdmin } from '@/lib/supabase';
import { generateAIResponse, retrieveRelevantKnowledgeContext } from '@/lib/ai';
import { findDirectFaqMatch, dynamicResponseCache } from '@/lib/faq-matcher';
import { evaluateHandoffRules } from '@/lib/handoff-engine';
import { dispatchWebhookEvent } from '@/lib/webhook-dispatcher';
import { analyzeMessageSentiment } from '@/lib/ai-insights';
import { verifyWidgetSession, signWidgetSession } from '@/lib/security-utils';
import type { Message, Agent } from '@/types';

export const dynamic = 'force-dynamic';

async function resolveWidgetTenant(request: Request, sessionId: string, token?: string | null): Promise<string | null> {
  if (!token) return null;

  const url = new URL(request.url);
  const workspaceParam = url.searchParams.get('workspace') || url.searchParams.get('key') || request.headers.get('x-widget-key');

  if (workspaceParam) {
    const supabase = getSupabaseAdmin();
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, is_active')
      .or(`id.eq.${workspaceParam},slug.eq.${workspaceParam}`)
      .maybeSingle();

    if (tenant && tenant.is_active !== false) {
      if (verifyWidgetSession(sessionId, tenant.id, token)) {
        return tenant.id;
      }
    }
  }

  // Fallback to default tenant verification
  const { tenantId } = await db.ensureDefaultTenantAndChannel();
  if (verifyWidgetSession(sessionId, tenantId, token)) {
    return tenantId;
  }

  return null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const token = request.headers.get('x-widget-token') || searchParams.get('token');

    if (!sessionId) {
      return NextResponse.json({ message: 'Missing sessionId parameter' }, { status: 400 });
    }

    const tenantId = await resolveWidgetTenant(request, sessionId, token);

    // Verify session HMAC token
    if (!tenantId) {
      return NextResponse.json(
        { message: 'Forbidden: Invalid or forged widget session token' },
        { status: 403 }
      );
    }

    return runWithRequestContext({ tenantId, userRole: 'viewer' }, async () => {
      const chatId = sessionId.includes('@') ? sessionId : `${sessionId}@webchat`;
      const messages = await db.getMessages(chatId);

      const validToken = token || signWidgetSession(sessionId, tenantId);

      return NextResponse.json(messages, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Widget-Token, X-Widget-Key',
          'X-Widget-Token': validToken,
        },
      });
    });
  } catch (error) {
    console.error('Failed to fetch widget messages:', error);
    return NextResponse.json({ message: 'Failed to fetch messages' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sessionId, text, visitorName, token } = body;
    const headerToken = request.headers.get('x-widget-token');
    const providedToken = token || headerToken;

    if (!sessionId || !text || typeof text !== 'string') {
      return NextResponse.json({ message: 'sessionId and text are required' }, { status: 400 });
    }

    const tenantId = await resolveWidgetTenant(request, sessionId, providedToken);

    if (!tenantId) {
      return NextResponse.json(
        { message: 'Forbidden: Invalid or forged widget session token' },
        { status: 403 }
      );
    }

    const cleanText = text.trim();
    if (!cleanText) {
      return NextResponse.json({ message: 'Message text cannot be empty' }, { status: 400 });
    }

    return runWithRequestContext({ tenantId, userRole: 'viewer' }, async () => {
      const chatId = sessionId.includes('@') ? sessionId : `${sessionId}@webchat`;
      const senderName = visitorName?.trim() || `Visitor ${sessionId.slice(0, 6)}`;

      const visitorMsgId = `web_${crypto.randomUUID()}`;
      const visitorTimestamp = Date.now();

      const visitorMessage: Message = {
        id: visitorMsgId,
        chatId,
        fromMe: false,
        text: cleanText,
        timestamp: visitorTimestamp,
        senderName,
        mediaType: 'text',
      };

      // 1. Persist visitor message
      await db.addMessage(visitorMessage);

      // 2. Real-time sentiment classification
      const sentiment = await analyzeMessageSentiment(cleanText);

      // 3. Update conversation in Inbox
      await db.updateConversation(chatId, {
        name: senderName,
        lastMessage: { text: cleanText, timestamp: visitorTimestamp },
        incrementUnread: true,
        sentiment,
      });

      // 4. Dispatch webhook
      dispatchWebhookEvent('message.received', {
        id: visitorMsgId,
        chatId,
        senderName,
        text: cleanText,
        timestamp: visitorTimestamp,
      }).catch(err => console.error('Webhook error:', err));

      // 5. Check if conversation is in human takeover mode
      const convo = await db.getConversation(chatId);
      if (convo && (convo.isBotPaused || convo.assignedAgentId === null || convo.assignedAgentId === '')) {
        return NextResponse.json(
          {
            visitorMessage,
            replyMessage: null,
            status: 'takeover',
            message: 'Your message has been received by our support team.',
          },
          {
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, X-Widget-Token, X-Widget-Key',
            },
          }
        );
      }

      // 6. Check automated handoff rules
      const recentMessages = await db.getMessages(chatId);
      const history = recentMessages
        .filter(m => m.id !== visitorMsgId)
        .slice(-6)
        .map(m => ({ fromMe: m.fromMe, text: m.text }));

      const handoffCheck = await evaluateHandoffRules({
        messageText: cleanText,
        history,
      });

      if (handoffCheck.shouldHandoff && handoffCheck.matchedRule) {
        const rule = handoffCheck.matchedRule;
        await db.setConversationTakeover(
          chatId,
          true,
          rule.actions?.assignToUserId,
          rule.name
        );

        const handoffNotice = handoffCheck.transitionMessage ||
          rule.actions?.transitionMessage ||
          'You have been transferred to a support specialist. An agent will respond shortly.';

        const noticeMsgId = `web_notice_${crypto.randomUUID()}`;
        const noticeMsg: Message = {
          id: noticeMsgId,
          chatId,
          fromMe: true,
          text: handoffNotice,
          timestamp: Date.now(),
          senderName: 'System',
          mediaType: 'text',
        };
        await db.addMessage(noticeMsg);

        dispatchWebhookEvent('handoff.triggered', {
          chatId,
          ruleName: rule.name,
          reason: handoffCheck.reason,
          assignedUserId: rule.actions?.assignToUserId,
          timestamp: Date.now(),
        }).catch(err => console.error('Webhook dispatch error:', err));

        return NextResponse.json(
          { visitorMessage, replyMessage: noticeMsg, status: 'handoff', handoffRule: rule.name },
          {
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, X-Widget-Token, X-Widget-Key',
            },
          }
        );
      }

      // 7. Generate automated AI response
      const agents = await db.getAgents();
      const activeAgent = agents.find(a => a.status === 'active') || agents[0];

      let replyText = 'Thank you for your message. An agent will be with you shortly.';

      // Check FAQ instant cache first
      const faqMatch = await findDirectFaqMatch(cleanText);
      if (faqMatch && faqMatch.answer) {
        replyText = faqMatch.answer;
      } else {
        const cached = dynamicResponseCache.get(cleanText);
        if (cached) {
          replyText = cached;
        } else if (activeAgent?.aiSettings) {
          try {
            const aiResponse = await generateAIResponse(
              cleanText,
              activeAgent.aiSettings,
              history
            );
            if (aiResponse) {
              replyText = aiResponse;
              dynamicResponseCache.set(cleanText, replyText);
            }
          } catch (aiErr) {
            console.error('Widget AI generation error:', aiErr);
          }
        }
      }

      const replyMsgId = `web_reply_${crypto.randomUUID()}`;
      const replyTimestamp = Date.now();

      const replyMessage: Message = {
        id: replyMsgId,
        chatId,
        fromMe: true,
        text: replyText,
        timestamp: replyTimestamp,
        senderName: activeAgent?.name || 'AI Assistant',
        mediaType: 'text',
      };

      // 8. Persist AI reply
      await db.addMessage(replyMessage);

      // Calculate FRT if this is first response
      const frt = replyTimestamp - visitorTimestamp;
      await db.updateConversation(chatId, {
        lastMessage: { text: replyText, timestamp: replyTimestamp },
        firstResponseTimeMs: frt,
      });

      return NextResponse.json(
        { visitorMessage, replyMessage, status: 'replied' },
        {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Widget-Token, X-Widget-Key',
          },
        }
      );
    });
  } catch (error: any) {
    console.error('Failed to process widget message:', error);
    return NextResponse.json({ message: error.message || 'Failed to process message' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Widget-Token, X-Widget-Key',
    },
  });
}
