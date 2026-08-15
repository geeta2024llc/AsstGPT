import { NextRequest, NextResponse } from 'next/server';
import { processProactiveReEngagements } from '@/lib/re-engagement-engine';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const POST = withApiAuth(
  async (request: NextRequest) => {
    try {
      let forceRun = false;
      try {
        const body = await request.json();
        forceRun = !!body.force;
      } catch (_) {}

      const result = await processProactiveReEngagements(forceRun);
      return NextResponse.json(result);
    } catch (error) {
      console.error('Failed to trigger re-engagements:', error);
      return NextResponse.json({ message: 'Failed to process re-engagements' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);
