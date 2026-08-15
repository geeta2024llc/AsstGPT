import { NextResponse } from 'next/server';
import { getAnalyticsData } from '@/lib/analytics';
import { withApiAuth } from '@/lib/api-guard';
import type { DashboardData } from '@/types';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async () => {
    try {
      const analytics = await getAnalyticsData('7d');

      const dashboardData: DashboardData = {
        stats: {
          sent: { value: analytics.kpis.outgoingMessages, change: '', changeType: 'neutral' },
          received: { value: analytics.kpis.incomingMessages, change: '', changeType: 'neutral' },
          activeAgents: { value: analytics.kpis.activeAgents, change: '', changeType: 'neutral' },
          errors: { value: analytics.errorAnalytics.totalErrors, change: '', changeType: 'neutral' },
        },
        messageTrend: analytics.messageTrend,
        errorBreakdown: analytics.errorAnalytics.byCategory,
        recentErrors: analytics.errorAnalytics.recentErrors,
      };

      return NextResponse.json(dashboardData);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      return NextResponse.json(
        { message: 'Failed to fetch dashboard data' },
        { status: 500 }
      );
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);
