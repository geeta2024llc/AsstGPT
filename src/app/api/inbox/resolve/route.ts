import { NextRequest, NextResponse } from 'next/server';
import { resolveConversation, addLog, updateConversation } from '@/lib/db';
import { dispatchWebhookEvent } from '@/lib/webhook-dispatcher';
import { generateConversationSummary } from '@/lib/ai-insights';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json();
      const { chatId, status, isResolved } = body;

      if (!chatId) {
        return NextResponse.json({ message: 'Missing required field: chatId' }, { status: 400 });
      }

      const resolved = status ? status === 'resolved' : (isResolved ?? true);

      await resolveConversation(chatId, resolved);

      if (resolved) {
        generateConversationSummary(chatId).catch((err) => console.error('Error generating AI summary:', err));
      }

      dispatchWebhookEvent(resolved ? 'conversation.resolved' : 'conversation.reopened', {
        chatId,
        status: resolved ? 'resolved' : 'open',
        resolvedAt: Date.now(),
      }).catch((err) => console.error('Webhook dispatch error:', err));

      await addLog({
        user: ctx.userId || 'Human Operator',
        action: resolved ? 'Conversation Resolved' : 'Conversation Reopened',
        details: resolved
          ? `Conversation ${chatId} was marked as resolved.`
          : `Conversation ${chatId} was reopened.`,
        type: resolved ? 'success' : 'info',
      });

      return NextResponse.json({
        success: true,
        chatId,
        status: resolved ? 'resolved' : 'open',
      });
    } catch (error) {
      console.error('Failed to resolve conversation:', error);
      return NextResponse.json({ message: 'Failed to update conversation resolution status' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);

export const PATCH = withApiAuth(
  async (request: NextRequest) => {
    try {
      const body = await request.json();
      const { chatId, unreadCount } = body;

      if (!chatId) {
        return NextResponse.json({ message: 'Missing required field: chatId' }, { status: 400 });
      }

      await updateConversation(chatId, {
        unreadCount: unreadCount !== undefined ? unreadCount : 0,
      });

      return NextResponse.json({ success: true, chatId, unreadCount: 0 });
    } catch (err: any) {
      console.error('Failed to patch conversation:', err);
      return NextResponse.json({ message: 'Failed to patch conversation' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);
