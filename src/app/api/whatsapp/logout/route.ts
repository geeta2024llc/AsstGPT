import { NextRequest, NextResponse } from 'next/server';
import { logoutTenant } from '@/lib/whatsapp-client';
import { withApiAuth } from '@/lib/api-guard';
import { addLog } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const POST = withApiAuth(
  async (_req: NextRequest, ctx) => {
    const tenantId = ctx.tenantId || process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
    try {
      await logoutTenant(tenantId);

      await addLog({
        user: ctx.userId || 'Admin',
        action: 'WhatsApp Session Terminated',
        details: `Admin manually terminated and disconnected the WhatsApp session for workspace ${tenantId}.`,
        type: 'warning',
      });

      return NextResponse.json({ success: true, message: 'Logged out successfully.' });
    } catch (error) {
      console.error(`Failed to logout whatsapp client for workspace ${tenantId}`, error);
      return NextResponse.json({ success: false, message: 'Logout failed.' }, { status: 500 });
    }
  },
  { roles: ['admin'] }
);
