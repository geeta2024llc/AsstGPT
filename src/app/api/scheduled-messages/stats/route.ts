import { NextRequest, NextResponse } from 'next/server';
import { getScheduledMessageStats } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async (request: NextRequest) => {
    try {
      const stats = await getScheduledMessageStats();
      return NextResponse.json(stats);
    } catch (error: any) {
      console.error('Failed to get scheduled message stats:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to get scheduled message stats' },
        { status: 500 }
      );
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);
