import { NextRequest, NextResponse } from 'next/server';
import { revokeTenantInvitation, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const DELETE = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const url = new URL(request.url);
      const id = url.pathname.split('/').pop() || '';

      await revokeTenantInvitation(id);

      await addLog({
        user: ctx.userId || 'Administrator',
        action: 'Team Invitation Revoked',
        details: `Revoked pending invitation ${id}`,
        type: 'warning',
      });

      return NextResponse.json({ success: true, id });
    } catch (error: any) {
      console.error('Failed to revoke invitation:', error);
      return NextResponse.json({ message: error.message || 'Failed to revoke invitation' }, { status: 500 });
    }
  },
  { roles: ['admin'] }
);
