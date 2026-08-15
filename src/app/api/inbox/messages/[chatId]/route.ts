
import { NextResponse } from 'next/server';
import { getMessages } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    // `params` is now an async proxy in Next.js 15 — await it before reading
    const { chatId } = await params;
    if (!chatId) {
      return NextResponse.json({ message: 'chatId is required' }, { status: 400 });
    }
    const url = new URL(request.url);
    const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined;
    const offset = url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!, 10) : undefined;

    const messages = await getMessages(chatId, { limit, offset });
    return NextResponse.json(messages);
  } catch (error) {
    console.error('Failed to fetch messages:', error);
    return NextResponse.json({ message: 'Failed to fetch messages' }, { status: 500 });
  }
}
