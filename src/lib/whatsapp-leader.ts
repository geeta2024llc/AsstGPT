import { getSupabaseAdmin } from './supabase';
import { init, sendMessage, WhatsAppClientState } from './whatsapp-client';

const REPLICA_ID =
  process.env.RAILWAY_REPLICA_ID ||
  process.env.HOSTNAME ||
  `replica_${Math.random().toString(36).substring(2, 9)}`;

const LEASE_DURATION_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

let isLeader = false;
let electionTimer: NodeJS.Timeout | null = null;
let queueProcessing = false;

export function getReplicaId(): string {
  return REPLICA_ID;
}

export function isCurrentReplicaLeader(): boolean {
  return isLeader;
}

/**
 * Attempts to claim or renew leadership for the WhatsApp session socket via lease-table CAS.
 */
export async function claimOrRenewLeadership(channelId = 'default'): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const now = new Date();
    const newExpiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString();

    // 1. Check current lease
    const { data: currentLock, error: selectErr } = await supabase
      .from('whatsapp_session_lock')
      .select('*')
      .eq('channel_id', channelId)
      .maybeSingle();

    if (selectErr) {
      console.error('[LEADER ELECTION] Error checking session lock:', selectErr.message);
      return isLeader;
    }

    const canClaim =
      !currentLock ||
      currentLock.holder_id === REPLICA_ID ||
      new Date(currentLock.lease_expires_at) < now;

    if (canClaim) {
      const { error: upsertErr } = await supabase
        .from('whatsapp_session_lock')
        .upsert(
          {
            channel_id: channelId,
            holder_id: REPLICA_ID,
            lease_expires_at: newExpiresAt,
            updated_at: now.toISOString(),
          },
          { onConflict: 'channel_id' }
        );

      if (!upsertErr) {
        if (!isLeader) {
          console.log(`[LEADER ELECTION] Replica ${REPLICA_ID} became LEADER for WhatsApp session.`);
          isLeader = true;
          // Bootstrap Baileys on leader
          init().catch(err => console.error('[LEADER] Failed to init WhatsApp on leader:', err));
        }

        // Leader mirrors current in-memory connection state to database table
        await mirrorConnectionStateToDb(channelId);

        // Leader processes any messages in the outbound queue
        processOutboundQueue().catch(err => console.error('[LEADER] Error processing outbound queue:', err));

        return true;
      }
    } else {
      if (isLeader) {
        console.warn(`[LEADER ELECTION] Replica ${REPLICA_ID} lost leadership to ${currentLock.holder_id}.`);
        isLeader = false;
      }
    }
  } catch (err: any) {
    console.error('[LEADER ELECTION] Unexpected error in election cycle:', err.message);
  }

  return isLeader;
}

/**
 * Mirrors the active in-memory WhatsApp connection state to whatsapp_connection_state table.
 */
export async function mirrorConnectionStateToDb(channelId = 'default'): Promise<void> {
  try {
    const state: WhatsAppClientState = global.whatsappState;
    if (!state) return;

    const supabase = getSupabaseAdmin();
    await supabase.from('whatsapp_connection_state').upsert(
      {
        channel_id: channelId,
        status: state.status,
        qr: state.qr,
        account: state.account,
        last_disconnect: state.lastDisconnect,
        connecting_since: state.connectingSince ? new Date(state.connectingSince).toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'channel_id' }
    );
  } catch (err: any) {
    console.error('[LEADER STATE MIRROR] Failed to mirror connection state:', err.message);
  }
}

/**
 * Reads mirrored connection state from DB (for non-leader replicas serving status API).
 */
export async function getMirroredConnectionState(channelId = 'default'): Promise<any> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('whatsapp_connection_state')
      .select('*')
      .eq('channel_id', channelId)
      .maybeSingle();

    return data;
  } catch (err) {
    return null;
  }
}

/**
 * Leader processes pending rows from whatsapp_outbound_queue table.
 */
export async function processOutboundQueue(): Promise<void> {
  if (!isLeader || queueProcessing) return;
  queueProcessing = true;

  try {
    const supabase = getSupabaseAdmin();
    const { data: pendingMessages, error } = await supabase
      .from('whatsapp_outbound_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(10);

    if (error || !pendingMessages || pendingMessages.length === 0) {
      queueProcessing = false;
      return;
    }

    for (const item of pendingMessages) {
      try {
        await supabase
          .from('whatsapp_outbound_queue')
          .update({ status: 'processing' })
          .eq('id', item.id);

        const result = await sendMessage(item.to_jid, item.text);

        await supabase
          .from('whatsapp_outbound_queue')
          .update({
            status: 'sent',
            result: result || { sent: true },
            processed_at: new Date().toISOString(),
          })
          .eq('id', item.id);
      } catch (sendErr: any) {
        console.error(`[LEADER QUEUE] Failed to dispatch queued message ${item.id}:`, sendErr);
        await supabase
          .from('whatsapp_outbound_queue')
          .update({
            status: 'failed',
            error: sendErr.message || 'Unknown error',
            processed_at: new Date().toISOString(),
          })
          .eq('id', item.id);
      }
    }
  } catch (err: any) {
    console.error('[LEADER QUEUE] Error during queue processing:', err.message);
  } finally {
    queueProcessing = false;
  }
}

/**
 * Non-leader replicas queue outbound messages and poll for leader execution.
 */
export async function enqueueOutboundMessage(to: string, text: string, maxWaitMs = 6000): Promise<any> {
  const supabase = getSupabaseAdmin();
  const { data: queued, error: insertErr } = await supabase
    .from('whatsapp_outbound_queue')
    .insert({
      to_jid: to,
      text,
      status: 'pending',
    })
    .select()
    .single();

  if (insertErr || !queued) {
    throw new Error(`Failed to queue outbound message: ${insertErr?.message}`);
  }

  // Poll for completion
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, 200));
    const { data: updated } = await supabase
      .from('whatsapp_outbound_queue')
      .select('*')
      .eq('id', queued.id)
      .single();

    if (updated) {
      if (updated.status === 'sent') {
        return updated.result || { sent: true };
      }
      if (updated.status === 'failed') {
        throw new Error(updated.error || 'Outbound send failed on leader replica');
      }
    }
  }

  throw new Error('Outbound send timed out waiting for leader replica.');
}

/**
 * Starts background leader election polling.
 */
export function startLeaderElection(): void {
  if (electionTimer) return;
  console.log(`[LEADER ELECTION] Starting election loop for replica ${REPLICA_ID}...`);
  claimOrRenewLeadership();
  electionTimer = setInterval(() => {
    claimOrRenewLeadership();
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Gracefully steps down leadership on server shutdown.
 */
export async function releaseLeadership(channelId = 'default'): Promise<void> {
  if (electionTimer) {
    clearInterval(electionTimer);
    electionTimer = null;
  }

  if (isLeader) {
    console.log(`[LEADER ELECTION] Replica ${REPLICA_ID} releasing leadership...`);
    try {
      const supabase = getSupabaseAdmin();
      await supabase
        .from('whatsapp_session_lock')
        .update({
          lease_expires_at: new Date(Date.now() - 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('channel_id', channelId)
        .eq('holder_id', REPLICA_ID);
    } catch (_) {}
    isLeader = false;
  }
}
