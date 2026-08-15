-- ============================================================================
-- AIWHISPER CONSOLIDATED PRODUCTION MIGRATION SCRIPT
-- Execute this script once in your Supabase SQL Editor (Dashboard -> SQL Editor -> New Query -> Run)
-- ============================================================================

-- 1. WhatsApp Session Lock & Replica Safety Tables
CREATE TABLE IF NOT EXISTS public.whatsapp_session_lock (
    channel_id VARCHAR PRIMARY KEY DEFAULT 'default',
    holder_id VARCHAR NOT NULL,
    lease_expires_at TIMESTAMPTZ NOT NULL,
    term BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.whatsapp_session_lock 
ADD COLUMN IF NOT EXISTS term BIGINT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.whatsapp_connection_state (
    channel_id VARCHAR PRIMARY KEY DEFAULT 'default',
    status VARCHAR NOT NULL DEFAULT 'disconnected',
    qr TEXT,
    account JSONB,
    last_disconnect JSONB,
    connecting_since TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_outbound_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_jid VARCHAR NOT NULL,
    text TEXT NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'pending',
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_outbound_queue_status_created 
ON public.whatsapp_outbound_queue(status, created_at ASC);

-- 2. Atomic Compare-And-Swap (CAS) WhatsApp Leader Election Lease
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
  SELECT * INTO v_current_lock
  FROM whatsapp_session_lock
  WHERE channel_id = p_channel_id
  FOR UPDATE;

  IF NOT FOUND THEN
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

  IF v_current_lock.holder_id = p_replica_id THEN
    UPDATE whatsapp_session_lock
    SET lease_expires_at = v_new_expiry,
        updated_at = v_now
    WHERE channel_id = p_channel_id
    RETURNING * INTO v_current_lock;

    RETURN QUERY SELECT TRUE, v_current_lock.term, v_current_lock.holder_id, v_current_lock.lease_expires_at;
    RETURN;
  ELSIF v_current_lock.lease_expires_at < v_now THEN
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

-- 4. Atomic Inbound Message Ingestion & Contact Deduplication
CREATE OR REPLACE FUNCTION public.add_message_atomic(
    p_tenant_id UUID,
    p_channel_id UUID,
    p_chat_id TEXT,
    p_provider_message_id TEXT,
    p_from_me BOOLEAN,
    p_text TEXT,
    p_sender_name TEXT DEFAULT NULL,
    p_media_type TEXT DEFAULT 'text',
    p_media_url TEXT DEFAULT NULL,
    p_transcription TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_timestamp TIMESTAMPTZ DEFAULT NOW(),
    p_normalized_phone TEXT DEFAULT NULL,
    p_raw_jid TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_contact_id UUID;
    v_conversation_id UUID;
    v_message_id UUID;
    v_existing_msg_id UUID;
    v_phone TEXT;
    v_lock_key BIGINT;
    v_canonical_name TEXT;
BEGIN
    v_phone := COALESCE(p_normalized_phone, REGEXP_REPLACE(SPLIT_PART(p_chat_id, '@', 1), '[^0-9]', '', 'g'));
    IF v_phone = '' THEN
        v_phone := SPLIT_PART(p_chat_id, '@', 1);
    END IF;

    v_lock_key := ('x' || SUBSTRING(MD5(p_tenant_id::text || ':' || v_phone), 1, 15))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    IF p_provider_message_id IS NOT NULL AND p_provider_message_id != '' THEN
        SELECT id INTO v_existing_msg_id
        FROM public.messages
        WHERE provider_message_id = p_provider_message_id
          AND tenant_id = p_tenant_id
        LIMIT 1;

        IF v_existing_msg_id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'duplicate', true,
                'message_id', v_existing_msg_id,
                'chat_id', p_chat_id
            );
        END IF;
    END IF;

    SELECT c.id, c.name INTO v_contact_id, v_canonical_name
    FROM public.contacts c
    WHERE c.tenant_id = p_tenant_id 
      AND c.phone = v_phone
    LIMIT 1;

    IF v_contact_id IS NULL THEN
        SELECT cc.contact_id, c.name INTO v_contact_id, v_canonical_name
        FROM public.contact_channels cc
        JOIN public.contacts c ON c.id = cc.contact_id
        WHERE cc.tenant_id = p_tenant_id
          AND (cc.external_id = p_chat_id OR (p_raw_jid IS NOT NULL AND cc.external_id = p_raw_jid))
        LIMIT 1;
    END IF;

    IF v_contact_id IS NULL THEN
        INSERT INTO public.contacts (
            tenant_id,
            name,
            phone,
            metadata,
            created_at,
            updated_at
        ) VALUES (
            p_tenant_id,
            CASE 
                WHEN p_from_me OR p_sender_name ILIKE 'AI Follow-Up%' OR p_sender_name ILIKE 'Me%' OR p_sender_name ILIKE 'System%' THEN v_phone
                ELSE COALESCE(NULLIF(TRIM(p_sender_name), ''), v_phone)
            END,
            v_phone,
            jsonb_build_object('source', 'whatsapp', 'initial_chat_id', p_chat_id),
            p_timestamp,
            p_timestamp
        )
        RETURNING id, name INTO v_contact_id, v_canonical_name;
    ELSE
        IF NOT p_from_me 
           AND p_sender_name IS NOT NULL 
           AND p_sender_name != '' 
           AND p_sender_name != v_phone 
           AND NOT (p_sender_name ILIKE 'AI Follow-Up%' OR p_sender_name ILIKE 'Me%' OR p_sender_name ILIKE 'System%')
           AND (v_canonical_name IS NULL OR v_canonical_name = v_phone OR v_canonical_name ~ '^[0-9+ ]+$' OR v_canonical_name ILIKE 'AI Follow-Up%' OR v_canonical_name ILIKE 'Client Pro Inquiries%') THEN
            UPDATE public.contacts
            SET name = p_sender_name,
                updated_at = p_timestamp
            WHERE id = v_contact_id;
            v_canonical_name := p_sender_name;
        END IF;
    END IF;

    INSERT INTO public.contact_channels (
        tenant_id,
        contact_id,
        channel_id,
        external_id,
        created_at
    ) VALUES (
        p_tenant_id,
        v_contact_id,
        p_channel_id,
        p_chat_id,
        p_timestamp
    )
    ON CONFLICT (channel_id, external_id) DO UPDATE
    SET contact_id = EXCLUDED.contact_id;

    IF p_raw_jid IS NOT NULL AND p_raw_jid != p_chat_id THEN
        INSERT INTO public.contact_channels (
            tenant_id,
            contact_id,
            channel_id,
            external_id,
            created_at
        ) VALUES (
            p_tenant_id,
            v_contact_id,
            p_channel_id,
            p_raw_jid,
            p_timestamp
        )
        ON CONFLICT (channel_id, external_id) DO UPDATE
        SET contact_id = EXCLUDED.contact_id;
    END IF;

    SELECT id INTO v_conversation_id
    FROM public.conversations
    WHERE tenant_id = p_tenant_id 
      AND contact_id = v_contact_id
      AND channel_id = p_channel_id
    LIMIT 1;

    IF v_conversation_id IS NULL THEN
        INSERT INTO public.conversations (
            tenant_id,
            channel_id,
            contact_id,
            last_message_at,
            last_message_text,
            unread_count,
            created_at,
            updated_at
        ) VALUES (
            p_tenant_id,
            p_channel_id,
            v_contact_id,
            p_timestamp,
            p_text,
            CASE WHEN p_from_me THEN 0 ELSE 1 END,
            p_timestamp,
            p_timestamp
        )
        RETURNING id INTO v_conversation_id;
    ELSE
        UPDATE public.conversations
        SET last_message_at = p_timestamp,
            last_message_text = p_text,
            unread_count = CASE WHEN p_from_me THEN 0 ELSE unread_count + 1 END,
            updated_at = p_timestamp
        WHERE id = v_conversation_id;
    END IF;

    INSERT INTO public.messages (
        tenant_id,
        conversation_id,
        channel_id,
        provider_message_id,
        sender_type,
        sender_id,
        sender_name,
        direction,
        body,
        media_type,
        media_url,
        transcription,
        metadata,
        created_at
    ) VALUES (
        p_tenant_id,
        v_conversation_id,
        p_channel_id,
        p_provider_message_id,
        CASE WHEN p_from_me THEN 'agent' ELSE 'contact' END,
        CASE WHEN p_from_me THEN 'system' ELSE v_contact_id::text END,
        COALESCE(p_sender_name, v_canonical_name),
        CASE WHEN p_from_me THEN 'outbound' ELSE 'inbound' END,
        p_text,
        p_media_type,
        p_media_url,
        p_transcription,
        p_metadata,
        p_timestamp
    )
    RETURNING id INTO v_message_id;

    RETURN jsonb_build_object(
        'duplicate', false,
        'message_id', v_message_id,
        'conversation_id', v_conversation_id,
        'contact_id', v_contact_id,
        'chat_id', p_chat_id
    );
END;
$$;

-- 5. Stored Procedure for Contact Deduplication
CREATE OR REPLACE FUNCTION public.merge_duplicate_contacts_atomic(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    r RECORD;
    v_merged_count INT := 0;
    v_primary_contact_id UUID;
    v_dup_id UUID;
BEGIN
    FOR r IN (
        SELECT phone, array_agg(id ORDER BY created_at ASC) AS contact_ids
        FROM public.contacts
        WHERE tenant_id = p_tenant_id AND phone IS NOT NULL AND phone != ''
        GROUP BY phone
        HAVING count(id) > 1
    ) LOOP
        v_primary_contact_id := r.contact_ids[1];
        
        FOR i IN 2 .. array_length(r.contact_ids, 1) LOOP
            v_dup_id := r.contact_ids[i];
            
            UPDATE public.contact_channels
            SET contact_id = v_primary_contact_id
            WHERE contact_id = v_dup_id;
            
            UPDATE public.conversations
            SET contact_id = v_primary_contact_id
            WHERE contact_id = v_dup_id;
            
            DELETE FROM public.contacts
            WHERE id = v_dup_id;
            
            v_merged_count := v_merged_count + 1;
        END LOOP;
    END LOOP;
    
    RETURN jsonb_build_object(
        'success', true,
        'merged_duplicates_count', v_merged_count
    );
END;
$$;

-- 10. Clean up legacy synthetic or corrupted contact names from previous runs
UPDATE public.contacts
SET name = COALESCE(NULLIF(phone, ''), 'WhatsApp Contact')
WHERE name ILIKE 'AI Follow-Up%' 
   OR name ILIKE 'Client Pro Inquiries%'
   OR name ILIKE 'test_%'
   OR name ILIKE 'Me'
   OR name ILIKE 'System';

