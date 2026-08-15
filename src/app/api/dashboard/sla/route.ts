import { NextResponse } from 'next/server';
import { getSLAMetrics } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async () => {
    try {
      const sla = await getSLAMetrics();
      return NextResponse.json(sla);
    } catch (error) {
      console.error('Failed to fetch SLA metrics:', error);
      return NextResponse.json({ message: 'Failed to fetch SLA metrics' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);
