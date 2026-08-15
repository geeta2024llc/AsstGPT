import { NextRequest, NextResponse } from 'next/server';
import { getMessages } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ chatId: string }> };

export const GET = withApiAuth<RouteContext>(
  async (request: NextRequest, _ctx, { params }) => {
    try {
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
  },
  { roles: ['admin', 'operator', 'viewer'] }
);
