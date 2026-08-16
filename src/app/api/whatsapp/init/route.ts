import { NextResponse } from 'next/server';
import { init } from '@/lib/whatsapp-client';
import { isCurrentReplicaLeader, claimOrRenewLeadership } from '@/lib/whatsapp-leader';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const POST = withApiAuth(
  async () => {
    try {
      if (isCurrentReplicaLeader()) {
        await init();
      } else {
        await claimOrRenewLeadership();
      }
      return NextResponse.json({ success: true, message: 'WhatsApp client initialization started.' });
    } catch (error) {
      console.error('Failed to init whatsapp client', error);
      return NextResponse.json({ success: false, message: 'Failed to initialize WhatsApp client.' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);
