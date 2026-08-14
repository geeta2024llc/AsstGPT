import { NextResponse } from 'next/server';
import { resolveConversation, addLog } from '@/lib/db';
import { dispatchWebhookEvent } from '@/lib/webhook-dispatcher';
import { generateConversationSummary } from '@/lib/ai-insights';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { chatId, status, isResolved } = body;

    if (!chatId) {
      return NextResponse.json({ message: 'Missing required field: chatId' }, { status: 400 });
    }

    const resolved = status ? status === 'resolved' : (isResolved ?? true);

    await resolveConversation(chatId, resolved);

    let generatedSummary: string | undefined;

    if (resolved) {
      // Trigger AI summary in background or await if fast
      generateConversationSummary(chatId)
        .then(res => {
          generatedSummary = res.summary;
        })
        .catch(err => console.error('Error generating AI summary:', err));
    }

    dispatchWebhookEvent(resolved ? 'conversation.resolved' : 'conversation.reopened', {
      chatId,
      status: resolved ? 'resolved' : 'open',
      resolvedAt: Date.now(),
    }).catch(err => console.error('Webhook dispatch error:', err));

    await addLog({
      user: 'Human Operator',
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
}
