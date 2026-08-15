-- ============================================================================
-- Migration: 20260815010000_replica_safety_and_atomic_messages.sql
-- Description: Multi-replica leader election leases, connection state mirroring,
-- outbound message queues, and atomic message insertion with advisory locks.
-- ============================================================================

-- 1. WhatsApp Session Leader Election Lease Table
CREATE TABLE IF NOT EXISTS public.whatsapp_session_lock (
    channel_id VARCHAR PRIMARY KEY DEFAULT 'default',
    holder_id VARCHAR NOT NULL,
    lease_expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. WhatsApp Connection State Mirror (Readable across all replicas)
CREATE TABLE IF NOT EXISTS public.whatsapp_connection_state (
    channel_id VARCHAR PRIMARY KEY DEFAULT 'default',
    status VARCHAR NOT NULL DEFAULT 'disconnected',
    qr TEXT,
    account JSONB,
    last_disconnect JSONB,
    connecting_since TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Outbound Message Queue for Non-Leader Replicas
CREATE TABLE IF NOT EXISTS public.whatsapp_outbound_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_jid VARCHAR NOT NULL,
    text TEXT NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'pending', -- pending, processing, sent, failed
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_outbound_queue_status ON public.whatsapp_outbound_queue (status, created_at);

-- 4. Atomic Message Insertion and Conversation State Update Procedure
CREATE OR REPLACE FUNCTION public.add_message_atomic(
    p_tenant_id UUID,
    p_channel_id UUID,
    p_chat_id TEXT,
    p_provider_message_id TEXT,
    p_sender_type TEXT,
    p_from_me BOOLEAN,
    p_sender_name TEXT,
    p_text TEXT,
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_created_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_contact_id UUID;
    v_conversation_id UUID;
    v_inserted_id UUID;
    v_contact_name TEXT;
BEGIN
    -- Transactional advisory lock per chat to serialize concurrent inserts for the same contact
    PERFORM pg_advisory_xact_lock(hashtext(p_chat_id));

    -- Determine clean contact name
    v_contact_name := COALESCE(NULLIF(p_sender_name, ''), split_part(p_chat_id, '@', 1));
    IF v_contact_name ILIKE 'me' OR v_contact_name ILIKE 'system' THEN
        v_contact_name := split_part(p_chat_id, '@', 1);
    END IF;

    -- Resolve or create contact / contact_channel
    SELECT contact_id INTO v_contact_id
    FROM public.contact_channels
    WHERE tenant_id = p_tenant_id AND external_id = p_chat_id
    LIMIT 1;

    IF v_contact_id IS NULL THEN
        INSERT INTO public.contacts (tenant_id, name, avatar_url)
        VALUES (
            p_tenant_id,
            v_contact_name,
            'https://placehold.co/100x100.png?text=' || upper(substring(v_contact_name from 1 for 1))
        )
        RETURNING id INTO v_contact_id;

        INSERT INTO public.contact_channels (tenant_id, contact_id, channel_id, external_id)
        VALUES (p_tenant_id, v_contact_id, p_channel_id, p_chat_id)
        ON CONFLICT (tenant_id, channel_id, external_id) DO NOTHING;
    END IF;

    -- Ensure conversation exists and get conversation_id
    INSERT INTO public.conversations (
        tenant_id,
        channel_id,
        contact_id,
        status,
        last_message_at,
        last_message_text,
        unread_count
    ) VALUES (
        p_tenant_id,
        p_channel_id,
        v_contact_id,
        'open',
        p_created_at,
        p_text,
        0
    )
    ON CONFLICT (tenant_id, channel_id, contact_id) DO UPDATE SET
        last_message_at = EXCLUDED.last_message_at
    RETURNING id INTO v_conversation_id;

    -- Insert message with unique constraint handling
    BEGIN
        INSERT INTO public.messages (
            tenant_id,
            conversation_id,
            provider_message_id,
            sender_type,
            from_me,
            sender_name,
            text,
            metadata,
            created_at
        ) VALUES (
            p_tenant_id,
            v_conversation_id,
            p_provider_message_id,
            p_sender_type,
            p_from_me,
            p_sender_name,
            p_text,
            p_metadata,
            p_created_at
        )
        RETURNING id INTO v_inserted_id;
    EXCEPTION WHEN unique_violation THEN
        -- Duplicate message detected: return duplicate flag without mutating unread count
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'message_id', p_provider_message_id
        );
    END;

    -- Update conversation with latest message and unread count only if message insert succeeded
    UPDATE public.conversations
    SET last_message_text = p_text,
        last_message_at = p_created_at,
        unread_count = CASE 
            WHEN p_from_me THEN public.conversations.unread_count 
            ELSE public.conversations.unread_count + 1 
        END,
        updated_at = NOW()
    WHERE id = v_conversation_id;

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'id', v_inserted_id,
        'contact_id', v_contact_id,
        'conversation_id', v_conversation_id
    );
END;
$$;
