import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { signWebhookPayload } from '@/lib/webhook-dispatcher';
import { recordWebhookDelivery, addLog } from '@/lib/db';
import type { WebhookEventType, WebhookPayload } from '@/types';

export const dynamic = 'force-dynamic';

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '169.254.169.254' ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
    return true;
  }

  // IPv4 private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16
  const parts = host.split('.').map(Number);
  if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 0) return true;
  }

  return false;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { webhookId, url, secret, event = 'handoff.triggered', sampleData } = body;

    if (!url || !secret) {
      return NextResponse.json({ message: 'URL and secret are required for testing' }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ message: 'Invalid endpoint URL' }, { status: 400 });
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return NextResponse.json({ message: 'Only HTTP and HTTPS webhook endpoints are permitted' }, { status: 400 });
    }

    if (isPrivateOrLocalHost(parsedUrl.hostname)) {
      return NextResponse.json(
        { message: 'Security Exception: Cannot dispatch test webhooks to private or local network addresses' },
        { status: 400 }
      );
    }

    const payload: WebhookPayload = {
      id: crypto.randomUUID(),
      event: (event as WebhookEventType) || 'handoff.triggered',
      timestamp: Date.now(),
      tenantId: process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001',
      data: sampleData || {
        chatId: '1234567890@s.whatsapp.net',
        ruleName: 'VIP Customer Support Escalation',
        reason: 'Customer requested human agent assistance regarding invoice.',
        assignedUserId: 'support-agent-1',
        isTest: true,
      },
    };

    const payloadString = JSON.stringify(payload);
    const signature = signWebhookPayload(payloadString, secret);
    const timestampHeader = String(payload.timestamp);

    const startTime = Date.now();
    let statusCode = 0;
    let success = false;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AIWhisper-Webhook-Dispatcher/1.0',
          'X-AIWhisper-Event': payload.event,
          'X-AIWhisper-Signature': `sha256=${signature}`,
          'X-AIWhisper-Timestamp': timestampHeader,
        },
        body: payloadString,
        signal: AbortSignal.timeout(8000), // 8s timeout for test
      });

      statusCode = response.status;
      success = response.ok;
    } catch (fetchErr: any) {
      statusCode = 0;
      success = false;
    }

    const durationMs = Date.now() - startTime;

    if (webhookId) {
      await recordWebhookDelivery(webhookId, statusCode, success);
    }

    await addLog({
      user: 'Administrator',
      action: 'Webhook Test Fired',
      details: `Test dispatch to ${parsedUrl.hostname} returned HTTP ${statusCode} in ${durationMs}ms`,
      type: success ? 'info' : 'warning',
    });

    return NextResponse.json({
      success,
      statusCode,
      durationMs,
      statusMessage: success ? 'Webhook endpoint responded successfully' : `Endpoint returned HTTP ${statusCode}`,
      payloadSent: payload,
    });
  } catch (error: any) {
    console.error('Failed to run webhook test:', error);
    return NextResponse.json({ message: error.message || 'Webhook test failed' }, { status: 500 });
  }
}
