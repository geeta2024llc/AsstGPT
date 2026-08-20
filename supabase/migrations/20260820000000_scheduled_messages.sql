-- ============================================================================
-- Migration: Scheduled Messages Schema and Leader Dispatch Atomic Claim
-- Date: 2026-08-20
-- ============================================================================

-- Table: scheduled_messages
CREATE TABLE IF NOT EXISTS public.scheduled_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_by_name TEXT,
    recipient_jid TEXT NOT NULL,
    recipient_name TEXT,
    message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'video')),
    content TEXT,
    media_url TEXT,
    media_mime_type TEXT,
    media_file_name TEXT,
    scheduled_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    baileys_message_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_tenant ON public.scheduled_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_dispatch
    ON public.scheduled_messages (status, scheduled_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_created_by
    ON public.scheduled_messages(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_created_at
    ON public.scheduled_messages(tenant_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;

-- Atomic batch claim function (fenced to current leader term)
CREATE OR REPLACE FUNCTION claim_scheduled_messages_batch(
    p_limit INT DEFAULT 5,
    p_channel_id TEXT DEFAULT 'default',
    p_replica_id TEXT DEFAULT NULL,
    p_expected_term BIGINT DEFAULT NULL
)
RETURNS SETOF scheduled_messages
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Fence: only the current leader can claim
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
    WITH due AS (
        SELECT id
        FROM scheduled_messages
        WHERE status = 'pending'
          AND scheduled_at <= clock_timestamp()
        ORDER BY scheduled_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE scheduled_messages sm
    SET status = 'processing',
        updated_at = clock_timestamp()
    FROM due
    WHERE sm.id = due.id
    RETURNING sm.*;
END;
$$;
