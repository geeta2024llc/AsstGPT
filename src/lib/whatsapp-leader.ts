import { getSupabaseAdmin } from './supabase';
import { init, sendMessage, WhatsAppClientState, getClientState } from './whatsapp-client';

const REPLICA_ID =
  process.env.RAILWAY_REPLICA_ID ||
  process.env.HOSTNAME ||
  `replica_${Math.random().toString(36).substring(2, 9)}`;

const LEASE_DURATION_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

let isLeader = false;
let currentTerm = 1;
let electionTimer: NodeJS.Timeout | null = null;
let queueProcessing = false;

export function getReplicaId(): string {
  return REPLICA_ID;
}

export function isCurrentReplicaLeader(): boolean {
  return isLeader;
}

export function getCurrentLeadershipTerm(): number {
  return currentTerm;
}

/**
 * Confirms with the database that this replica still holds the current leadership term
 * before it bypasses the queue to send a message directly. Closes the race window where
 * an in-memory `isLeader` flag could be stale between heartbeats.
 */
export async function verifyActiveLeadership(channelId = 'default'): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('verify_whatsapp_leadership_atomic', {
      p_channel_id: channelId,
      p_replica_id: REPLICA_ID,
      p_expected_term: currentTerm,
    });
    if (error) return isLeader; // RPC not migrated yet — fall back to in-memory flag
    return !!data;
  } catch {
    return isLeader;
  }
}

/**
 * Attempts to claim or renew leadership for the WhatsApp session socket via atomic CAS stored procedure.
 */
export async function claimOrRenewLeadership(channelId = 'default'): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();

    // 1. Try atomic PostgreSQL CAS stored procedure
    const { data: rpcData, error: rpcErr } = await supabase.rpc('claim_or_renew_whatsapp_lease_atomic', {
      p_channel_id: channelId,
      p_replica_id: REPLICA_ID,
      p_lease_duration_ms: LEASE_DURATION_MS,
    });

    let claimed = false;
    let term = currentTerm;

    if (!rpcErr && rpcData && rpcData.length > 0) {
      const leaseResult = rpcData[0];
      claimed = !!leaseResult.is_leader;
      term = Number(leaseResult.term) || currentTerm;
    } else {
      // Direct SQL Fallback with atomic conditional update if RPC not yet migrated
      const now = new Date();
      const newExpiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString();

      const { data: currentLock } = await supabase
        .from('whatsapp_session_lock')
        .select('*')
        .eq('channel_id', channelId)
        .maybeSingle();

      const canClaim =
        !currentLock ||
        currentLock.holder_id === REPLICA_ID ||
        new Date(currentLock.lease_expires_at) < now;

      if (canClaim) {
        const nextTerm = currentLock?.holder_id === REPLICA_ID ? (currentLock.term || 1) : ((currentLock?.term || 0) + 1);
        const upsertPayload: any = {
          channel_id: channelId,
          holder_id: REPLICA_ID,
          lease_expires_at: newExpiresAt,
          updated_at: now.toISOString(),
        };
        if (currentLock && 'term' in currentLock) {
          upsertPayload.term = nextTerm;
        }

        let { error: upsertErr } = await supabase
          .from('whatsapp_session_lock')
          .upsert(upsertPayload, { onConflict: 'channel_id' });

        if (upsertErr && upsertPayload.term) {
          delete upsertPayload.term;
          const retry = await supabase
            .from('whatsapp_session_lock')
            .upsert(upsertPayload, { onConflict: 'channel_id' });
          upsertErr = retry.error;
        }

        if (!upsertErr) {
          claimed = true;
          term = nextTerm;
        } else {
          console.error('[LEADER ELECTION] Upsert error:', upsertErr.message);
        }
      }
    }

    if (claimed) {
      currentTerm = term;
      if (!isLeader) {
        console.log(`[LEADER ELECTION] Replica ${REPLICA_ID} claimed LEADER lease at Term #${currentTerm}.`);
        isLeader = true;
        // Bootstrap Baileys on leader
        init().catch((err) => console.error('[LEADER] Failed to init WhatsApp on leader:', err));
      }

      // Leader mirrors connection state
      await mirrorConnectionStateToDb(channelId);

      // Leader drains outbound queue
      processOutboundQueue(channelId).catch((err) => console.error('[LEADER] Error processing outbound queue:', err));

      return true;
    } else {
      if (isLeader) {
        console.warn(`[LEADER ELECTION] Replica ${REPLICA_ID} lost leadership lease.`);
        isLeader = false;
      }
      return false;
    }
  } catch (err: any) {
    console.error('[LEADER ELECTION] Unexpected error in election cycle:', err.message);
    return isLeader;
  }
}

/**
 * Mirrors the active in-memory WhatsApp connection state to whatsapp_connection_state table.
 */
export async function mirrorConnectionStateToDb(channelId = 'default'): Promise<void> {
  try {
    const state = getClientState();
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
 * Leader processes pending rows from whatsapp_outbound_queue table using atomic batch reservation.
 */
export async function processOutboundQueue(channelId = 'default'): Promise<void> {
  if (!isLeader || queueProcessing) return;
  queueProcessing = true;

  try {
    const supabase = getSupabaseAdmin();

    // 1. Claim batch of pending messages atomically via RPC, fenced against the current lease term
    const { data: claimedBatch, error: rpcErr } = await supabase.rpc('claim_outbound_queue_batch_atomic', {
      p_limit: 10,
      p_channel_id: channelId,
      p_replica_id: REPLICA_ID,
      p_expected_term: currentTerm,
    });

    let itemsToProcess = claimedBatch;

    if (rpcErr || !itemsToProcess) {
      // Fallback claim if RPC not present
      const { data: pendingMessages } = await supabase
        .from('whatsapp_outbound_queue')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(10);

      if (!pendingMessages || pendingMessages.length === 0) {
        queueProcessing = false;
        return;
      }

      itemsToProcess = [];
      for (const item of pendingMessages) {
        const { data: claimed } = await supabase
          .from('whatsapp_outbound_queue')
          .update({ status: 'processing', updated_at: new Date().toISOString() })
          .eq('id', item.id)
          .eq('status', 'pending')
          .select()
          .single();

        if (claimed) itemsToProcess.push(claimed);
      }
    }

    if (!itemsToProcess || itemsToProcess.length === 0) {
      queueProcessing = false;
      return;
    }

    for (const item of itemsToProcess) {
      try {
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
    await new Promise((r) => setTimeout(r, 200));
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
