import crypto from 'crypto';
import { getWebhooks, recordWebhookDelivery, addLog, ensureDefaultTenantAndChannel } from './db';
import { getRequestContext } from './request-context';
import { validateSafeWebhookUrl } from './security-utils';
import type { WebhookEventType, WebhookPayload, WebhookConfig } from '@/types';

/**
 * Computes an HMAC-SHA256 signature for webhook payload verification.
 */
export function signWebhookPayload(payloadString: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
}

/**
 * Dispatches an event to all active matching webhook endpoints in the tenant.
 * Non-blocking, failsafe, and logs delivery results.
 */
export async function dispatchWebhookEvent<T = any>(
  event: WebhookEventType,
  data: T
): Promise<{ totalMatched: number; successful: number; failed: number }> {
  try {
    const webhooks = await getWebhooks();
    const activeMatching = webhooks.filter(
      w => w.isActive && (w.events.includes(event) || w.events.includes('*' as any))
    );

    if (activeMatching.length === 0) {
      return { totalMatched: 0, successful: 0, failed: 0 };
    }

    const ctx = getRequestContext();
    const { tenantId: resolvedTenantId } = await ensureDefaultTenantAndChannel();
    const tenantId = ctx?.tenantId || resolvedTenantId;

    const payload: WebhookPayload<T> = {
      id: crypto.randomUUID(),
      event,
      timestamp: Date.now(),
      tenantId,
      data,
    };

    const payloadString = JSON.stringify(payload);

    const deliveryPromises = activeMatching.map(async (webhook) => {
      // Re-verify URL safety before outbound dispatch to prevent DNS rebinding
      const urlCheck = validateSafeWebhookUrl(webhook.url);
      if (!urlCheck.valid) {
        console.warn(`[WEBHOOK SSRF BLOCKED] Blocked dispatch to "${webhook.url}": ${urlCheck.reason}`);
        await recordWebhookDelivery(webhook.id, 400, false);
        return { webhookId: webhook.id, success: false, status: 400, error: urlCheck.reason };
      }

      const signature = signWebhookPayload(payloadString, webhook.secret);
      const timestampHeader = String(payload.timestamp);

      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'AIWhisper-Webhook-Dispatcher/1.0',
            'X-AIWhisper-Event': event,
            'X-AIWhisper-Signature': `sha256=${signature}`,
            'X-AIWhisper-Timestamp': timestampHeader,
          },
          body: payloadString,
          signal: AbortSignal.timeout(6000), // 6s timeout
        });

        await recordWebhookDelivery(webhook.id, response.status, response.ok);
        return { webhookId: webhook.id, success: response.ok, status: response.status };
      } catch (err: any) {
        console.warn(`[WEBHOOK] Delivery failed for "${webhook.name}" (${webhook.url}):`, err.message);
        await recordWebhookDelivery(webhook.id, 0, false);
        return { webhookId: webhook.id, success: false, status: 0, error: err.message };
      }
    });

    const results = await Promise.allSettled(deliveryPromises);
    let successful = 0;
    let failed = 0;

    results.forEach(res => {
      if (res.status === 'fulfilled' && res.value.success) {
        successful++;
      } else {
        failed++;
      }
    });

    await addLog({
      user: 'System',
      action: 'Webhook Event Dispatched',
      details: `Event "${event}" sent to ${activeMatching.length} endpoints (${successful} ok, ${failed} failed)`,
      type: failed > 0 ? 'warning' : 'info',
    });

    return { totalMatched: activeMatching.length, successful, failed };
  } catch (error) {
    console.error(`[WEBHOOK] Critical error dispatching event "${event}":`, error);
    return { totalMatched: 0, successful: 0, failed: 0 };
  }
}
