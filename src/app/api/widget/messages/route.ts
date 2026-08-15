import { NextResponse } from 'next/server';
import crypto from 'crypto';
import * as db from '@/lib/db';
import { generateAIResponse, retrieveRelevantKnowledgeContext } from '@/lib/ai';
import { findDirectFaqMatch, dynamicResponseCache } from '@/lib/faq-matcher';
import { evaluateHandoffRules } from '@/lib/handoff-engine';
import { dispatchWebhookEvent } from '@/lib/webhook-dispatcher';
import { analyzeMessageSentiment } from '@/lib/ai-insights';
import type { Message, Agent } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ message: 'Missing sessionId parameter' }, { status: 400 });
    }

    const chatId = sessionId.includes('@') ? sessionId : `${sessionId}@webchat`;
    const messages = await db.getMessages(chatId);

    return NextResponse.json(messages, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
    });
  } catch (error) {
    console.error('Failed to fetch widget messages:', error);
    return NextResponse.json({ message: 'Failed to fetch messages' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sessionId, text, visitorName } = body;

    if (!sessionId || !text || typeof text !== 'string') {
      return NextResponse.json({ message: 'sessionId and text are required' }, { status: 400 });
    }

    const cleanText = text.trim();
    if (!cleanText) {
      return NextResponse.json({ message: 'Message text cannot be empty' }, { status: 400 });
    }

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
        rule.actions.assignToUserId,
        handoffCheck.reason,
        {
          ruleId: rule.id,
          ruleName: rule.name,
          detectedIntent: handoffCheck.detectedIntent,
          triggeredAt: new Date().toISOString(),
        }
      );

      const transitionText = rule.actions.transitionMessage || 'I am transferring you to a live support agent. Please hold on.';
      const replyMsgId = `web_reply_${crypto.randomUUID()}`;
      const replyTimestamp = Date.now();

      const replyMessage: Message = {
        id: replyMsgId,
        chatId,
        fromMe: true,
        text: transitionText,
        timestamp: replyTimestamp,
        senderName: 'Support Agent',
        mediaType: 'text',
      };

      await db.addMessage(replyMessage);
      await db.updateConversation(chatId, {
        lastMessage: { text: transitionText, timestamp: replyTimestamp },
      });

      return NextResponse.json(
        { visitorMessage, replyMessage, status: 'handoff_triggered' },
        {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          },
        }
      );
    }

    // 7. Select active agent and generate AI response
    const agents = await db.getAgents();
    const activeAgent: Agent | undefined =
      agents.find(a => a.id === convo?.assignedAgentId) ||
      agents.find(a => a.status === 'active') ||
      agents[0];

    let replyText = 'Thank you for reaching out. How can I assist you further?';
    let answeredFromFastPath = false;

    if (activeAgent?.aiSettings) {
      // Step A: Fast-path FAQ matching from knowledge base ($0 LLM cost)
      try {
        const directFaq = await findDirectFaqMatch(cleanText, activeAgent.aiSettings.knowledgeFileIds);
        if (directFaq.matched && directFaq.answer) {
          replyText = directFaq.answer;
          answeredFromFastPath = true;
        }
      } catch (faqErr) {
        console.warn('Widget FAQ match error:', faqErr);
      }

      // Step B: Check Dynamic In-Memory Response Cache ($0 LLM cost)
      if (!answeredFromFastPath) {
        const cached = dynamicResponseCache.get(cleanText);
        if (cached) {
          replyText = cached;
          answeredFromFastPath = true;
        }
      }

      // Step C: Fall back to LLM generation only on miss
      if (!answeredFromFastPath) {
        try {
          const { context: ragContext } = await retrieveRelevantKnowledgeContext(
            cleanText,
            activeAgent.aiSettings.knowledgeFileIds
          );

          replyText = await generateAIResponse(
            cleanText,
            activeAgent.aiSettings,
            history
          );

          if (replyText) {
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
        },
      }
    );
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
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
