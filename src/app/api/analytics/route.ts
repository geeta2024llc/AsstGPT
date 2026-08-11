import { NextResponse } from 'next/server';
import { getAnalyticsData } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rangeParam = searchParams.get('range');
    const range: 'today' | '7d' | '30d' = 
      rangeParam === 'today' ? 'today' :
      rangeParam === '30d' ? '30d' : '7d';

    const data = await getAnalyticsData(range);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch analytics data:', error);
    return NextResponse.json(
      { message: 'Failed to fetch analytics data', error: (error as Error).message },
      { status: 500 }
    );
  }
}
