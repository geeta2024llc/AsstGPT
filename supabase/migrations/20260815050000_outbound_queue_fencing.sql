-- ============================================================================
-- Migration: Outbound Queue Fencing
-- Date: 2026-08-15
-- ============================================================================
-- claim_outbound_queue_batch_atomic previously took no replica/term arguments,
-- meaning any caller could drain the outbound queue regardless of whether it
-- actually held the WhatsApp leadership lease -- the in-memory `isLeader` flag
-- on each replica was trusted implicitly, creating a race window between
-- heartbeats where a stale leader could still send messages. This migration
-- makes the database (whatsapp_session_lock) the source of truth for fencing.

-- 1. Fenced queue batch claim: reject the claim entirely if the caller's
--    replica/term no longer matches the current lease holder.
CREATE OR REPLACE FUNCTION claim_outbound_queue_batch_atomic(
  p_limit INT DEFAULT 10,
  p_channel_id TEXT DEFAULT 'default',
  p_replica_id TEXT DEFAULT NULL,
  p_expected_term BIGINT DEFAULT NULL
)
RETURNS SETOF whatsapp_outbound_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_replica_id IS NOT NULL AND p_expected_term IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM whatsapp_session_lock
      WHERE channel_id = p_channel_id
        AND holder_id = p_replica_id
        AND term = p_expected_term
        AND lease_expires_at > clock_timestamp()
    ) THEN
      RETURN; -- Stale leader: claim nothing
    END IF;
  END IF;

  RETURN QUERY
  WITH reserved AS (
    SELECT id
    FROM whatsapp_outbound_queue
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE whatsapp_outbound_queue q
  SET status = 'processing',
      updated_at = clock_timestamp()
  FROM reserved
  WHERE q.id = reserved.id
  RETURNING q.*;
END;
$$;

-- 2. Lightweight leadership verification for the manual-send fast path,
--    cheaper than a full queue claim.
CREATE OR REPLACE FUNCTION verify_whatsapp_leadership_atomic(
  p_channel_id TEXT,
  p_replica_id TEXT,
  p_expected_term BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM whatsapp_session_lock
    WHERE channel_id = p_channel_id
      AND holder_id = p_replica_id
      AND term = p_expected_term
      AND lease_expires_at > clock_timestamp()
  );
END;
$$;
