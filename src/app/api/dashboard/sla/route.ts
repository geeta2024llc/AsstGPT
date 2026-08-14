import { NextResponse } from 'next/server';
import { getSLAMetrics } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sla = await getSLAMetrics();
    return NextResponse.json(sla);
  } catch (error) {
    console.error('Failed to fetch SLA metrics:', error);
    return NextResponse.json({ message: 'Failed to fetch SLA metrics' }, { status: 500 });
  }
}
