import { NextRequest, NextResponse } from 'next/server';
import { getClientState } from '@/lib/whatsapp-client';
import { isCurrentReplicaLeader, getMirroredConnectionState } from '@/lib/whatsapp-leader';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async (_req: NextRequest) => {
    if (isCurrentReplicaLeader()) {
      const state = getClientState();
      return NextResponse.json(state);
    }

    const mirrored = await getMirroredConnectionState();
    if (mirrored) {
      return NextResponse.json({
        status: mirrored.status,
        qr: mirrored.qr,
        account: mirrored.account,
        lastDisconnect: mirrored.last_disconnect,
        connectingSince: mirrored.connecting_since ? new Date(mirrored.connecting_since).getTime() : null,
        initializing: false,
      });
    }

    return NextResponse.json(getClientState());
  },
  { roles: ['admin', 'operator'] }
);
