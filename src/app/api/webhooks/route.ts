import { NextRequest, NextResponse } from 'next/server';
import { getWebhooks, createWebhook, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';
import { validateSafeWebhookUrl } from '@/lib/security-utils';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async () => {
    try {
      const webhooks = await getWebhooks();
      const masked = webhooks.map((w) => ({
        ...w,
        secret: w.secret ? `${w.secret.slice(0, 6)}••••••••` : undefined,
      }));
      return NextResponse.json(masked);
    } catch (error) {
      console.error('Failed to get webhooks:', error);
      return NextResponse.json({ message: 'Failed to fetch webhooks' }, { status: 500 });
    }
  },
  { roles: ['admin'] }
);

export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json();
      const { name, url, events, secret, isActive } = body;

      if (!name || !url || !events || !Array.isArray(events) || events.length === 0) {
        return NextResponse.json(
          { message: 'Missing required fields: name, url, events (array)' },
          { status: 400 }
        );
      }

      // SSRF validation against private/loopback/link-local/metadata IPs
      const urlCheck = validateSafeWebhookUrl(url.trim());
      if (!urlCheck.valid) {
        return NextResponse.json(
          { message: `Invalid webhook destination: ${urlCheck.reason}` },
          { status: 400 }
        );
      }

      const generatedSecret = secret?.trim() || `whsec_${crypto.randomBytes(24).toString('hex')}`;

      const newWebhook = await createWebhook({
        name: name.trim(),
        url: url.trim(),
        secret: generatedSecret,
        events,
        isActive: isActive ?? true,
      });

      await addLog({
        user: ctx.userId || 'Administrator',
        action: 'Webhook Created',
        details: `Created outbound webhook "${newWebhook.name}" subscribing to [${events.join(', ')}]`,
        type: 'info',
      });

      return NextResponse.json(newWebhook, { status: 201 });
    } catch (error: any) {
      console.error('Failed to create webhook:', error);
      return NextResponse.json({ message: error.message || 'Failed to create webhook' }, { status: 500 });
    }
  },
  { roles: ['admin'] }
);
