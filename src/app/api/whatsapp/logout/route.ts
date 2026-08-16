import { NextRequest, NextResponse } from 'next/server';
import { logout } from '@/lib/whatsapp-client';
import { withApiAuth } from '@/lib/api-guard';
import { addLog } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const POST = withApiAuth(
  async (_req: NextRequest, ctx) => {
    try {
      await logout();

      await addLog({
        user: ctx.userId || 'Admin',
        action: 'WhatsApp Session Terminated',
        details: 'Admin manually terminated and disconnected the WhatsApp session.',
        type: 'warning',
      });

      return NextResponse.json({ success: true, message: 'Logged out successfully.' });
    } catch (error) {
      console.error('Failed to logout whatsapp client', error);
      return NextResponse.json({ success: false, message: 'Logout failed.' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);
