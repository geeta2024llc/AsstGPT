-- Migration: 20260815030000_leader_cas_and_fencing.sql
-- Description: Atomic Compare-And-Swap (CAS) WhatsApp leader election with monotonic term fencing tokens
-- and concurrency-safe queue batch claiming using FOR UPDATE SKIP LOCKED.

-- 1. Ensure columns exist on whatsapp_session_lock
ALTER TABLE whatsapp_session_lock 
ADD COLUMN IF NOT EXISTS term BIGINT NOT NULL DEFAULT 1;

-- 2. Atomic Leader Lease Claim / Renewal Stored Procedure
CREATE OR REPLACE FUNCTION claim_or_renew_whatsapp_lease_atomic(
  p_channel_id TEXT,
  p_replica_id TEXT,
  p_lease_duration_ms INT DEFAULT 30000
)
RETURNS TABLE (
  is_leader BOOLEAN,
  term BIGINT,
  holder_id TEXT,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_new_expiry TIMESTAMPTZ := v_now + (p_lease_duration_ms || ' milliseconds')::INTERVAL;
  v_current_lock whatsapp_session_lock%ROWTYPE;
BEGIN
  -- 1. Lock existing row or insert if not present
  SELECT * INTO v_current_lock
  FROM whatsapp_session_lock
  WHERE channel_id = p_channel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- No lock exists yet -> Create and claim leadership at term 1
    INSERT INTO whatsapp_session_lock (
      channel_id,
      holder_id,
      lease_expires_at,
      term,
      updated_at
    )
    VALUES (
      p_channel_id,
      p_replica_id,
      v_new_expiry,
      1,
      v_now
    )
    RETURNING * INTO v_current_lock;

    RETURN QUERY SELECT TRUE, v_current_lock.term, v_current_lock.holder_id, v_current_lock.lease_expires_at;
    RETURN;
  END IF;

  -- 2. Evaluate if current replica can claim or renew
  IF v_current_lock.holder_id = p_replica_id THEN
    -- Renewal by existing leader: retain current term, extend lease expiry
    UPDATE whatsapp_session_lock
    SET lease_expires_at = v_new_expiry,
        updated_at = v_now
    WHERE channel_id = p_channel_id
    RETURNING * INTO v_current_lock;

    RETURN QUERY SELECT TRUE, v_current_lock.term, v_current_lock.holder_id, v_current_lock.lease_expires_at;
    RETURN;
  ELSIF v_current_lock.lease_expires_at < v_now THEN
    -- Previous lease expired: elect new leader and increment monotonic fencing term
    UPDATE whatsapp_session_lock
    SET holder_id = p_replica_id,
        lease_expires_at = v_new_expiry,
        term = v_current_lock.term + 1,
        updated_at = v_now
    WHERE channel_id = p_channel_id
    RETURNING * INTO v_current_lock;

    RETURN QUERY SELECT TRUE, v_current_lock.term, v_current_lock.holder_id, v_current_lock.lease_expires_at;
    RETURN;
  ELSE
    -- Active lease held by another replica: reject claim
    RETURN QUERY SELECT FALSE, v_current_lock.term, v_current_lock.holder_id, v_current_lock.lease_expires_at;
    RETURN;
  END IF;
END;
$$;

-- 3. Atomic Outbound Queue Batch Reservation using FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION claim_outbound_queue_batch_atomic(
  p_limit INT DEFAULT 10
)
RETURNS SETOF whatsapp_outbound_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
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
