import { NextRequest, NextResponse } from 'next/server';
import {
  getScheduledMessage,
  updateScheduledMessage,
  deleteScheduledMessage,
} from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApiAuth<RouteContext>(
  async (request: NextRequest, _ctx, { params }) => {
    try {
      const { id } = await params;
      const message = await getScheduledMessage(id);
      if (!message) {
        return NextResponse.json({ error: 'Scheduled message not found' }, { status: 404 });
      }
      return NextResponse.json(message);
    } catch (error: any) {
      console.error('Failed to get scheduled message:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to get scheduled message' },
        { status: 500 }
      );
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

export const PATCH = withApiAuth<RouteContext>(
  async (request: NextRequest, _ctx, { params }) => {
    try {
      const { id } = await params;
      const existing = await getScheduledMessage(id);
      if (!existing) {
        return NextResponse.json({ error: 'Scheduled message not found' }, { status: 404 });
      }

      const body = await request.json();
      const {
        content,
        mediaUrl,
        mediaMimeType,
        mediaFileName,
        scheduledAt,
        status,
      } = body;

      const updates: any = {};

      if (content !== undefined) updates.content = content.trim();
      if (mediaUrl !== undefined) updates.mediaUrl = mediaUrl;
      if (mediaMimeType !== undefined) updates.mediaMimeType = mediaMimeType;
      if (mediaFileName !== undefined) updates.mediaFileName = mediaFileName;

      if (scheduledAt !== undefined) {
        const scheduledDate = new Date(scheduledAt);
        if (isNaN(scheduledDate.getTime())) {
          return NextResponse.json(
            { error: 'Invalid date/time format for scheduledAt' },
            { status: 400 }
          );
        }
        if (scheduledDate.getTime() < Date.now() - 10000 && existing.status === 'pending') {
          return NextResponse.json(
            { error: 'Rescheduled time cannot be in the past' },
            { status: 400 }
          );
        }
        updates.scheduledAt = scheduledDate.toISOString();
      }

      if (status !== undefined) {
        if (!['pending', 'cancelled'].includes(status)) {
          return NextResponse.json(
            { error: 'Status can only be updated to pending or cancelled manually' },
            { status: 400 }
          );
        }
        updates.status = status;
      }

      const updated = await updateScheduledMessage(id, updates);
      if (!updated) {
        return NextResponse.json(
          { error: 'Failed to update scheduled message' },
          { status: 500 }
        );
      }

      return NextResponse.json(updated);
    } catch (error: any) {
      console.error('Failed to update scheduled message:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to update scheduled message' },
        { status: 500 }
      );
    }
  },
  { roles: ['admin', 'operator'] }
);

export const DELETE = withApiAuth<RouteContext>(
  async (_request: NextRequest, _ctx, { params }) => {
    try {
      const { id } = await params;
      const existing = await getScheduledMessage(id);
      if (!existing) {
        return NextResponse.json({ error: 'Scheduled message not found' }, { status: 404 });
      }

      const deleted = await deleteScheduledMessage(id);
      if (!deleted) {
        return NextResponse.json(
          { error: 'Failed to delete scheduled message' },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true });
    } catch (error: any) {
      console.error('Failed to delete scheduled message:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to delete scheduled message' },
        { status: 500 }
      );
    }
  },
  { roles: ['admin', 'operator'] }
);
