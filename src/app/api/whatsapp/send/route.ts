import { NextRequest, NextResponse } from 'next/server';
import { sendMessageForTenant } from '@/lib/whatsapp-client';
import { updateConversation } from '@/lib/db';
import { isCurrentReplicaLeader, enqueueOutboundMessage, verifyActiveLeadership } from '@/lib/whatsapp-leader';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const { to, text, assignedUserId } = await request.json();
      if (!to || !text) {
        return NextResponse.json({ success: false, message: 'Missing "to" or "text" field' }, { status: 400 });
      }
      const tenantId = ctx.tenantId || process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

      // Atomically engage human takeover so bot does not race with manual operator responses
      await updateConversation(to, {
        isBotPaused: true,
        takeoverReason: 'Manual operator response from inbox',
        assignedUserId: assignedUserId || ctx.userId || undefined,
      });

      let result: any;
      if (isCurrentReplicaLeader() && (await verifyActiveLeadership())) {
        result = await sendMessageForTenant(tenantId, to, text);
      } else {
        result = await enqueueOutboundMessage(to, text);
      }

      return NextResponse.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Failed to send message', error);
      return NextResponse.json({ success: false, message: error.message || 'Failed to send message' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);
