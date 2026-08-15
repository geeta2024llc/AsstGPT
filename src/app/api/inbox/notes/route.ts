import { NextRequest, NextResponse } from 'next/server';
import { getConversationNotes, createConversationNote, addLog } from '@/lib/db';
import { dispatchWebhookEvent } from '@/lib/webhook-dispatcher';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async (request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const chatId = searchParams.get('chatId');

      if (!chatId) {
        return NextResponse.json({ message: 'Missing chatId parameter' }, { status: 400 });
      }

      const notes = await getConversationNotes(chatId);
      return NextResponse.json(notes);
    } catch (error) {
      console.error('Failed to get conversation notes:', error);
      return NextResponse.json({ message: 'Failed to fetch internal notes' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json();
      const { chatId, content, userName, userAvatar, userId } = body;

      if (!chatId || !content) {
        return NextResponse.json({ message: 'Missing required fields: chatId and content' }, { status: 400 });
      }

      const authorName = userName || ctx.userId || 'Agent';

      const note = await createConversationNote({
        chatId,
        content: content.trim(),
        userName: authorName,
        userAvatar: userAvatar || undefined,
        userId: userId || ctx.userId || undefined,
      });

      dispatchWebhookEvent('note.created', {
        chatId,
        note,
        timestamp: Date.now(),
      }).catch((err) => console.error('Webhook dispatch error:', err));

      await addLog({
        user: authorName,
        action: 'Internal Note Added',
        details: `Added internal note to conversation ${chatId}: "${content.slice(0, 80)}"`,
        type: 'info',
      });

      return NextResponse.json(note, { status: 201 });
    } catch (error: any) {
      console.error('Failed to create internal note:', error);
      return NextResponse.json({ message: error.message || 'Failed to create internal note' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);
