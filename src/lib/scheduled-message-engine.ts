import { getSupabaseAdmin } from './supabase';
import {
  sendMessageForTenant,
  sendImageForTenant,
  sendVideoForTenant,
} from './whatsapp-client';
import {
  getReplicaId,
  getCurrentLeadershipTerm,
  isCurrentReplicaLeader,
} from './whatsapp-leader';
import { addLog } from './db';
import type { ScheduledMessageType } from '@/types';

let isProcessingScheduled = false;

export interface ScheduledDispatchResult {
  dispatched: number;
  failed: number;
  details: Array<{
    id: string;
    recipientJid: string;
    status: 'sent' | 'failed';
    error?: string;
  }>;
}

/**
 * Scans and dispatches due scheduled messages using atomic leader-fenced batch reservation.
 * Should be called periodically by the replica holding the active WhatsApp session lock.
 */
export async function processScheduledMessages(
  channelId = 'default'
): Promise<ScheduledDispatchResult> {
  if (!isCurrentReplicaLeader() || isProcessingScheduled) {
    return { dispatched: 0, failed: 0, details: [] };
  }

  isProcessingScheduled = true;
  const result: ScheduledDispatchResult = {
    dispatched: 0,
    failed: 0,
    details: [],
  };

  try {
    const supabase = getSupabaseAdmin();
    const replicaId = getReplicaId();
    const currentTerm = getCurrentLeadershipTerm();

    // 1. Claim batch of due scheduled messages atomically via RPC
    const { data: claimedBatch, error: rpcErr } = await supabase.rpc(
      'claim_scheduled_messages_batch',
      {
        p_limit: 5,
        p_channel_id: channelId,
        p_replica_id: replicaId,
        p_expected_term: currentTerm,
      }
    );

    let itemsToProcess = claimedBatch;

    if (rpcErr || !itemsToProcess) {
      // Fallback claim if RPC not present
      const nowIso = new Date().toISOString();
      const { data: pendingMessages } = await supabase
        .from('scheduled_messages')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_at', nowIso)
        .order('scheduled_at', { ascending: true })
        .limit(5);

      if (!pendingMessages || pendingMessages.length === 0) {
        return result;
      }

      itemsToProcess = [];
      for (const item of pendingMessages) {
        const { data: claimed } = await supabase
          .from('scheduled_messages')
          .update({
            status: 'processing',
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id)
          .eq('status', 'pending')
          .select()
          .single();

        if (claimed) itemsToProcess.push(claimed);
      }
    }

    if (!itemsToProcess || itemsToProcess.length === 0) {
      return result;
    }

    for (const item of itemsToProcess) {
      const tenantId =
        item.tenant_id ||
        process.env.DEFAULT_TENANT_ID ||
        '00000000-0000-0000-0000-000000000001';
      const msgType: ScheduledMessageType = item.message_type || 'text';
      const recipientJid = item.recipient_jid;
      const content = item.content || '';
      const mediaUrl = item.media_url;

      try {
        let sendResult: any;

        if (msgType === 'image' && mediaUrl) {
          sendResult = await sendImageForTenant(
            tenantId,
            recipientJid,
            mediaUrl,
            content
          );
        } else if (msgType === 'video' && mediaUrl) {
          sendResult = await sendVideoForTenant(
            tenantId,
            recipientJid,
            mediaUrl,
            content
          );
        } else {
          sendResult = await sendMessageForTenant(
            tenantId,
            recipientJid,
            content || '[Scheduled Message]'
          );
        }

        const baileysId = sendResult?.key?.id || null;

        await supabase
          .from('scheduled_messages')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            baileys_message_id: baileysId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);

        result.dispatched++;
        result.details.push({
          id: item.id,
          recipientJid,
          status: 'sent',
        });

        await addLog({
          user: 'Scheduled Dispatcher',
          action: 'Scheduled Message Sent',
          details: `Delivered ${msgType} message to ${item.recipient_name || recipientJid} (ID: ${item.id})`,
          type: 'success',
        });
      } catch (sendErr: any) {
        console.error(
          `[SCHEDULED DISPATCHER] Failed to send scheduled message ${item.id}:`,
          sendErr
        );

        const errorMsg = sendErr?.message || 'Failed to dispatch via WhatsApp socket';

        await supabase
          .from('scheduled_messages')
          .update({
            status: 'failed',
            error_message: errorMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);

        result.failed++;
        result.details.push({
          id: item.id,
          recipientJid,
          status: 'failed',
          error: errorMsg,
        });

        await addLog({
          user: 'Scheduled Dispatcher',
          action: 'Scheduled Message Dispatch Failed',
          details: `Failed to deliver to ${recipientJid}: ${errorMsg}`,
          type: 'error',
        });
      }
    }

    return result;
  } catch (err: any) {
    console.error(
      '[SCHEDULED DISPATCHER] Unexpected error during scheduled message cycle:',
      err
    );
    return result;
  } finally {
    isProcessingScheduled = false;
  }
}
