
import { NextResponse } from 'next/server';
import { sendMessage } from '@/lib/whatsapp-client';
import { updateConversation } from '@/lib/db';
import { isCurrentReplicaLeader, enqueueOutboundMessage } from '@/lib/whatsapp-leader';

export async function POST(request: Request) {
  try {
    const { to, text, assignedUserId } = await request.json();
    if (!to || !text) {
      return NextResponse.json({ success: false, message: 'Missing "to" or "text" field' }, { status: 400 });
    }

    // Atomically engage human takeover so bot does not race with manual operator responses
    await updateConversation(to, {
      isBotPaused: true,
      takeoverReason: 'Manual operator response from inbox',
      assignedUserId: assignedUserId || undefined,
    });

    let result: any;
    if (isCurrentReplicaLeader()) {
      result = await sendMessage(to, text);
    } else {
      result = await enqueueOutboundMessage(to, text);
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Failed to send message', error);
    return NextResponse.json({ success: false, message: error.message || 'Failed to send message' }, { status: 500 });
  }
}
