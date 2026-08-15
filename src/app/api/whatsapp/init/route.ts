import { NextResponse } from 'next/server';
import { init } from '@/lib/whatsapp-client';
import { isCurrentReplicaLeader, claimOrRenewLeadership } from '@/lib/whatsapp-leader';

export async function POST() {
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
}
