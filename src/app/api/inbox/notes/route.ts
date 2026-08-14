import { NextResponse } from 'next/server';
import { getConversationNotes, createConversationNote, addLog } from '@/lib/db';
import { dispatchWebhookEvent } from '@/lib/webhook-dispatcher';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
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
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { chatId, content, userName, userAvatar, userId } = body;

    if (!chatId || !content) {
      return NextResponse.json({ message: 'Missing required fields: chatId and content' }, { status: 400 });
    }

    const note = await createConversationNote({
      chatId,
      content: content.trim(),
      userName: userName || 'Agent',
      userAvatar: userAvatar || undefined,
      userId: userId || undefined,
    });

    dispatchWebhookEvent('note.created', {
      chatId,
      note,
      timestamp: Date.now(),
    }).catch(err => console.error('Webhook dispatch error:', err));

    await addLog({
      user: userName || 'Agent',
      action: 'Internal Note Added',
      details: `Added internal note to conversation ${chatId}: "${content.slice(0, 80)}"`,
      type: 'info',
    });

    return NextResponse.json(note, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create internal note:', error);
    return NextResponse.json({ message: error.message || 'Failed to create internal note' }, { status: 500 });
  }
}
