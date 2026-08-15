-- ============================================================================
-- Migration: Contact Deduplication, JID/LID Reconciliation & Sync Fix
-- Date: 2026-08-15
-- ============================================================================

-- 1. Upgrade add_message_atomic procedure with Phone Extraction & Message-First Atomicity
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
    v_normalized_jid TEXT;
    v_phone_number TEXT;
    v_contact_id UUID;
    v_conversation_id UUID;
    v_inserted_id UUID;
    v_contact_name TEXT;
    v_existing_contact_name TEXT;
    v_has_letters BOOLEAN;
BEGIN
    -- 1. JID Normalization: Strip device suffixes (e.g., '12345:12@s.whatsapp.net' -> '12345@s.whatsapp.net')
    v_normalized_jid := regexp_replace(p_chat_id, ':[0-9]+@', '@');

    -- 2. Extract phone number if it is a phone-based WhatsApp JID or digits
    IF v_normalized_jid LIKE '%@s.whatsapp.net' OR v_normalized_jid LIKE '%@c.us' THEN
        v_phone_number := split_part(v_normalized_jid, '@', 1);
    ELSE
        v_phone_number := NULL;
    END IF;

    -- Transactional advisory lock per contact/phone to serialize concurrent messages
    IF v_phone_number IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('contact_' || p_tenant_id::text || '_' || v_phone_number));
    ELSE
        PERFORM pg_advisory_xact_lock(hashtext('contact_' || p_tenant_id::text || '_' || v_normalized_jid));
    END IF;

    -- 3. Determine clean sender name
    v_contact_name := COALESCE(NULLIF(TRIM(p_sender_name), ''), split_part(v_normalized_jid, '@', 1));
    IF v_contact_name ILIKE 'me' OR v_contact_name ILIKE 'system' OR v_contact_name = '.' THEN
        v_contact_name := split_part(v_normalized_jid, '@', 1);
    END IF;

    -- 4. Smart Contact Lookup: First by exact normalized external_id, then fallback by phone_number
    SELECT contact_id INTO v_contact_id
    FROM public.contact_channels
    WHERE tenant_id = p_tenant_id AND external_id = v_normalized_jid
    LIMIT 1;

    -- Fallback: If not found by external_id, check if a contact exists for this phone_number
    IF v_contact_id IS NULL AND v_phone_number IS NOT NULL THEN
        SELECT contact_id INTO v_contact_id
        FROM public.contact_channels
        WHERE tenant_id = p_tenant_id AND phone_number = v_phone_number
        LIMIT 1;

        -- If found by phone number, associate this new external_id (e.g. LID or alternate JID) with the existing contact!
        IF v_contact_id IS NOT NULL THEN
            INSERT INTO public.contact_channels (tenant_id, contact_id, channel_id, external_id, phone_number)
            VALUES (p_tenant_id, v_contact_id, p_channel_id, v_normalized_jid, v_phone_number)
            ON CONFLICT (tenant_id, channel_id, external_id) DO NOTHING;
        END IF;
    END IF;

    -- 5. If contact does not exist anywhere, create a new contact
    IF v_contact_id IS NULL THEN
        INSERT INTO public.contacts (tenant_id, name, push_name, avatar_url)
        VALUES (
            p_tenant_id,
            v_contact_name,
            NULLIF(TRIM(p_sender_name), ''),
            'https://placehold.co/100x100.png?text=' || upper(substring(v_contact_name from 1 for 1))
        )
        RETURNING id INTO v_contact_id;

        INSERT INTO public.contact_channels (tenant_id, contact_id, channel_id, external_id, phone_number)
        VALUES (p_tenant_id, v_contact_id, p_channel_id, v_normalized_jid, v_phone_number)
        ON CONFLICT (tenant_id, channel_id, external_id) DO NOTHING;
    ELSE
        -- 6. Dynamic Name Upgrade: If existing contact has a generic/numeric name and a real human name is now provided, upgrade it!
        SELECT name INTO v_existing_contact_name FROM public.contacts WHERE id = v_contact_id;
        v_has_letters := p_sender_name ~ '[a-zA-Z\u0900-\u097F]';
        IF v_has_letters AND (
            v_existing_contact_name ~ '^[0-9+ ]+$' OR 
            v_existing_contact_name ILIKE 'WhatsApp User%' OR
            v_existing_contact_name = split_part(v_normalized_jid, '@', 1)
        ) THEN
            UPDATE public.contacts
            SET name = TRIM(p_sender_name),
                push_name = TRIM(p_sender_name),
                updated_at = NOW()
            WHERE id = v_contact_id;
        END IF;
    END IF;

    -- 7. Ensure conversation exists WITHOUT advancing timestamp or text yet
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
        COALESCE(p_text, ''),
        0
    )
    ON CONFLICT (tenant_id, channel_id, contact_id) DO NOTHING;

    -- Fetch the conversation ID
    SELECT id INTO v_conversation_id
    FROM public.conversations
    WHERE tenant_id = p_tenant_id AND channel_id = p_channel_id AND contact_id = v_contact_id
    LIMIT 1;

    -- 8. Message-First Insert with unique constraint violation handling
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
        -- Duplicate message detected: Return immediately WITHOUT mutating last_message_at or last_message_text!
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'message_id', p_provider_message_id,
            'conversation_id', v_conversation_id,
            'contact_id', v_contact_id
        );
    END;

    -- 9. Atomically update conversation state only when message insertion actually succeeded
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


-- 2. Stored Procedure to Merge Existing Duplicate Ghost Contacts in a Tenant
CREATE OR REPLACE FUNCTION public.merge_duplicate_contacts_atomic(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    v_primary_contact_id UUID;
    v_merged_count INT := 0;
BEGIN
    -- Find groups of duplicate contacts sharing the same phone number
    FOR r IN (
        SELECT cc.phone_number, array_agg(DISTINCT cc.contact_id ORDER BY cc.contact_id) as contact_ids
        FROM public.contact_channels cc
        WHERE cc.tenant_id = p_tenant_id AND cc.phone_number IS NOT NULL AND cc.phone_number <> ''
        GROUP BY cc.phone_number
        HAVING count(DISTINCT cc.contact_id) > 1
    ) LOOP
        -- Select primary contact (prefer one with a real non-numeric name, else first created)
        SELECT id INTO v_primary_contact_id
        FROM public.contacts
        WHERE id = ANY(r.contact_ids)
        ORDER BY (name ~ '[a-zA-Z\u0900-\u097F]') DESC, created_at ASC
        LIMIT 1;

        -- Reassign contact_channels to primary contact
        UPDATE public.contact_channels
        SET contact_id = v_primary_contact_id
        WHERE contact_id = ANY(r.contact_ids) AND contact_id <> v_primary_contact_id;

        -- Reassign conversation notes to primary contact chat
        -- (notes are keyed by chat_id/tenant_id)

        -- Delete duplicate conversations for merged contacts
        DELETE FROM public.conversations
        WHERE contact_id = ANY(r.contact_ids) AND contact_id <> v_primary_contact_id;

        -- Delete duplicate contacts
        DELETE FROM public.contacts
        WHERE id = ANY(r.contact_ids) AND id <> v_primary_contact_id;

        v_merged_count := v_merged_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'tenant_id', p_tenant_id,
        'merged_groups', v_merged_count
    );
END;
$$;
