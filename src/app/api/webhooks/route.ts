import { NextResponse } from 'next/server';
import { getWebhooks, createWebhook, addLog } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const webhooks = await getWebhooks();
    return NextResponse.json(webhooks);
  } catch (error) {
    console.error('Failed to get webhooks:', error);
    return NextResponse.json({ message: 'Failed to fetch webhooks' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, url, events, secret, isActive } = body;

    if (!name || !url || !events || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { message: 'Missing required fields: name, url, events (array)' },
        { status: 400 }
      );
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ message: 'Invalid webhook endpoint URL' }, { status: 400 });
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
      user: 'Administrator',
      action: 'Webhook Created',
      details: `Created outbound webhook "${newWebhook.name}" subscribing to [${events.join(', ')}]`,
      type: 'info',
    });

    return NextResponse.json(newWebhook, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create webhook:', error);
    return NextResponse.json({ message: error.message || 'Failed to create webhook' }, { status: 500 });
  }
}
