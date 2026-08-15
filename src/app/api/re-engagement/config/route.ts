import { NextRequest, NextResponse } from 'next/server';
import { getReEngagementConfig, updateReEngagementConfig, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async () => {
    try {
      const config = await getReEngagementConfig();
      return NextResponse.json(config);
    } catch (error) {
      console.error('Failed to fetch re-engagement config:', error);
      return NextResponse.json({ message: 'Failed to fetch re-engagement config' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json();
      const updated = await updateReEngagementConfig(body);

      await addLog({
        user: ctx.userId || 'Admin',
        action: 'Re-Engagement Config Updated',
        details: `Proactive re-engagement ${updated.isEnabled ? 'ENABLED' : 'DISABLED'} (Threshold: ${updated.inactivityHoursThreshold}h, Max: ${updated.maxFollowUpsPerConversation})`,
        type: 'info',
      });

      return NextResponse.json(updated);
    } catch (error) {
      console.error('Failed to update re-engagement config:', error);
      return NextResponse.json({ message: 'Failed to update re-engagement config' }, { status: 500 });
    }
  },
  { roles: ['admin'] }
);
