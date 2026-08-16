import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/api-guard';
import { resetAnalyticsBaseline, addLog } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const POST = withApiAuth(
  async (_req: NextRequest, ctx) => {
    const tenantId = ctx.tenantId || process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
    try {
      await resetAnalyticsBaseline(tenantId);

      await addLog({
        user: ctx.userId || 'Admin',
        action: 'Dashboard Analytics Reset',
        details: `Admin reset the AI Command Center dashboard to zero for workspace ${tenantId}. Underlying conversations and messages were preserved.`,
        type: 'warning',
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error(`Failed to reset analytics baseline for workspace ${tenantId}`, error);
      return NextResponse.json({ success: false, message: 'Failed to reset dashboard analytics.' }, { status: 500 });
    }
  },
  { roles: ['admin'] }
);
