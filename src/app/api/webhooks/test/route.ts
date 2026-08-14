import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { signWebhookPayload } from '@/lib/webhook-dispatcher';
import { recordWebhookDelivery, addLog } from '@/lib/db';
import type { WebhookEventType, WebhookPayload } from '@/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { webhookId, url, secret, event = 'handoff.triggered', sampleData } = body;

    if (!url || !secret) {
      return NextResponse.json({ message: 'URL and secret are required for testing' }, { status: 400 });
    }

    try {
      new URL(url);
    } catch {
      return NextResponse.json({ message: 'Invalid endpoint URL' }, { status: 400 });
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
    let responseText = '';
    let statusCode = 0;
    let success = false;
    let headersObj: Record<string, string> = {};

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
      responseText = (await response.text()).slice(0, 1000); // cap to 1KB

      response.headers.forEach((val, key) => {
        headersObj[key] = val;
      });
    } catch (fetchErr: any) {
      statusCode = 0;
      success = false;
      responseText = `Request Error: ${fetchErr.message}`;
    }

    const durationMs = Date.now() - startTime;

    if (webhookId) {
      await recordWebhookDelivery(webhookId, statusCode, success);
    }

    await addLog({
      user: 'Administrator',
      action: 'Webhook Test Fired',
      details: `Test dispatch to ${url} returned HTTP ${statusCode} in ${durationMs}ms`,
      type: success ? 'info' : 'warning',
    });

    return NextResponse.json({
      success,
      statusCode,
      durationMs,
      responseBody: responseText,
      responseHeaders: headersObj,
      payloadSent: payload,
      signatureSent: `sha256=${signature}`,
    });
  } catch (error: any) {
    console.error('Failed to run webhook test:', error);
    return NextResponse.json({ message: error.message || 'Webhook test failed' }, { status: 500 });
  }
}
