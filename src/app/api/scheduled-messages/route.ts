import { NextRequest, NextResponse } from 'next/server';
import {
  getScheduledMessages,
  createScheduledMessage,
} from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';
import type { ScheduledMessageStatus, ScheduledMessageType } from '@/types';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async (request: NextRequest) => {
    try {
      const searchParams = request.nextUrl.searchParams;
      const statusParam = searchParams.get('status') as ScheduledMessageStatus | null;
      const limitParam = searchParams.get('limit');
      const offsetParam = searchParams.get('offset');

      const messages = await getScheduledMessages({
        status: statusParam || undefined,
        limit: limitParam ? parseInt(limitParam, 10) : undefined,
        offset: offsetParam ? parseInt(offsetParam, 10) : undefined,
      });

      return NextResponse.json(messages);
    } catch (error: any) {
      console.error('Failed to fetch scheduled messages:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to fetch scheduled messages' },
        { status: 500 }
      );
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json();
      const {
        recipientJid,
        recipientName,
        messageType = 'text',
        content,
        mediaUrl,
        mediaMimeType,
        mediaFileName,
        scheduledAt,
      } = body;

      if (!recipientJid) {
        return NextResponse.json(
          { error: 'Missing required field: recipientJid' },
          { status: 400 }
        );
      }

      if (!scheduledAt) {
        return NextResponse.json(
          { error: 'Missing required field: scheduledAt' },
          { status: 400 }
        );
      }

      // Check scheduled time is not significantly in the past (allow 10s leeway for network latency)
      const scheduledDate = new Date(scheduledAt);
      if (isNaN(scheduledDate.getTime())) {
        return NextResponse.json(
          { error: 'Invalid date/time format for scheduledAt' },
          { status: 400 }
        );
      }

      if (scheduledDate.getTime() < Date.now() - 10000) {
        return NextResponse.json(
          { error: 'Scheduled time cannot be in the past' },
          { status: 400 }
        );
      }

      if (messageType === 'text' && (!content || !content.trim())) {
        return NextResponse.json(
          { error: 'Text message requires non-empty content' },
          { status: 400 }
        );
      }

      if ((messageType === 'image' || messageType === 'video') && !mediaUrl) {
        return NextResponse.json(
          { error: `${messageType} message requires a valid mediaUrl` },
          { status: 400 }
        );
      }

      // Normalize recipient JID if phone number is provided without @s.whatsapp.net
      let formattedJid = recipientJid.trim();
      if (!formattedJid.includes('@')) {
        formattedJid = `${formattedJid.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
      }

      const created = await createScheduledMessage({
        recipientJid: formattedJid,
        recipientName: recipientName?.trim() || undefined,
        messageType: messageType as ScheduledMessageType,
        content: content?.trim() || undefined,
        mediaUrl: mediaUrl || undefined,
        mediaMimeType: mediaMimeType || undefined,
        mediaFileName: mediaFileName || undefined,
        scheduledAt: scheduledDate.toISOString(),
        createdByUserId: ctx.userId || undefined,
        createdByName: ctx.userRole === 'admin' ? 'Admin' : 'Operator',
      });

      return NextResponse.json(created, { status: 201 });
    } catch (error: any) {
      console.error('Failed to create scheduled message:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to create scheduled message' },
        { status: 500 }
      );
    }
  },
  { roles: ['admin', 'operator'] }
);
