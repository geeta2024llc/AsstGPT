import { NextRequest, NextResponse } from 'next/server';
import { getConversations } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async (request: NextRequest) => {
    try {
      const url = new URL(request.url);
      const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined;
      const offset = url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!, 10) : undefined;

      const conversations = await getConversations({ limit, offset });
      return NextResponse.json(conversations);
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
      return NextResponse.json({ message: 'Failed to fetch conversations' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);
