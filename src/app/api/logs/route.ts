import { NextRequest, NextResponse } from 'next/server';
import { getPaginatedLogs } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async (request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get('page') || '1', 10);
      const pageSize = parseInt(searchParams.get('pageSize') || searchParams.get('limit') || '10', 10);
      const type = searchParams.get('type') || undefined;
      const search = searchParams.get('search') || undefined;

      const result = await getPaginatedLogs({
        page,
        pageSize,
        type,
        search,
      });

      return NextResponse.json(result);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
      return NextResponse.json({ message: 'Failed to fetch logs' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);
