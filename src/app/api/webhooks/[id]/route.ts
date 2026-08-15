import { NextRequest, NextResponse } from 'next/server';
import { getWebhook, updateWebhook, deleteWebhook, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApiAuth<RouteContext>(
  async (_request: NextRequest, _ctx, { params }) => {
    try {
      const { id } = await params;
      const webhook = await getWebhook(id);

      if (!webhook) {
        return NextResponse.json({ message: 'Webhook not found' }, { status: 404 });
      }

      const masked = {
        ...webhook,
        secret: webhook.secret ? `${webhook.secret.slice(0, 6)}••••••••` : undefined,
      };

      return NextResponse.json(masked);
    } catch (error) {
      console.error('Failed to get webhook:', error);
      return NextResponse.json({ message: 'Failed to fetch webhook' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

export const PUT = withApiAuth<RouteContext>(
  async (request: NextRequest, ctx, { params }) => {
    try {
      const { id } = await params;
      const body = await request.json();

      const existing = await getWebhook(id);
      if (!existing) {
        return NextResponse.json({ message: 'Webhook not found' }, { status: 404 });
      }

      if (body.url) {
        try {
          new URL(body.url);
        } catch {
          return NextResponse.json({ message: 'Invalid webhook endpoint URL' }, { status: 400 });
        }
      }

      await updateWebhook(id, body);

      await addLog({
        user: ctx.userId || 'Administrator',
        action: 'Webhook Updated',
        details: `Updated webhook "${body.name || existing.name}" (${id})`,
        type: 'info',
      });

      const refreshed = await getWebhook(id);
      return NextResponse.json(refreshed);
    } catch (error: any) {
      console.error('Failed to update webhook:', error);
      return NextResponse.json({ message: error.message || 'Failed to update webhook' }, { status: 500 });
    }
  },
  { roles: ['admin'] }
);

export const DELETE = withApiAuth<RouteContext>(
  async (_request: NextRequest, ctx, { params }) => {
    try {
      const { id } = await params;
      const existing = await getWebhook(id);

      if (!existing) {
        return NextResponse.json({ message: 'Webhook not found' }, { status: 404 });
      }

      await deleteWebhook(id);

      await addLog({
        user: ctx.userId || 'Administrator',
        action: 'Webhook Deleted',
        details: `Deleted webhook "${existing.name}" (${existing.url})`,
        type: 'warning',
      });

      return NextResponse.json({ success: true, id });
    } catch (error: any) {
      console.error('Failed to delete webhook:', error);
      return NextResponse.json({ message: error.message || 'Failed to delete webhook' }, { status: 500 });
    }
  },
  { roles: ['admin'] }
);
