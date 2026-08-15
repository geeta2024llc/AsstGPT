import { NextResponse } from 'next/server';
import { getClientState } from '@/lib/whatsapp-client';
import { isCurrentReplicaLeader, getMirroredConnectionState } from '@/lib/whatsapp-leader';

export const dynamic = 'force-dynamic';

export async function GET() {
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
}
