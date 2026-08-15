-- ============================================================================
-- Migration: Manual Contact Merge (history-preserving)
-- Date: 2026-08-15
-- ============================================================================
-- Unlike merge_duplicate_contacts_atomic (which deletes the duplicate's
-- conversation outright, appropriate for true ghost contacts with no real
-- history), this RPC targets a specific pair chosen by an admin -- e.g. an
-- @lid-based contact that WhatsApp's Baileys library cannot automatically
-- resolve to a phone number -- and preserves the duplicate's message history
-- by moving it onto the primary contact's conversation instead of deleting it.

CREATE OR REPLACE FUNCTION public.merge_two_contacts_atomic(
    p_tenant_id UUID,
    p_primary_contact_id UUID,
    p_duplicate_contact_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    v_primary_conv_id UUID;
    v_dup_last_message_at TIMESTAMPTZ;
    v_dup_last_message_text TEXT;
    v_dup_unread_count INT;
BEGIN
    IF p_primary_contact_id = p_duplicate_contact_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Primary and duplicate contact cannot be the same.');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_primary_contact_id AND tenant_id = p_tenant_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Primary contact not found.');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_duplicate_contact_id AND tenant_id = p_tenant_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Duplicate contact not found.');
    END IF;

    -- 1. Reassign contact_channels to the primary contact
    UPDATE public.contact_channels
    SET contact_id = p_primary_contact_id
    WHERE contact_id = p_duplicate_contact_id AND tenant_id = p_tenant_id;

    -- 2. Fold each of the duplicate's conversations into the primary, preserving message history
    FOR r IN (
        SELECT id, channel_id, last_message_at, last_message_text, unread_count
        FROM public.conversations
        WHERE contact_id = p_duplicate_contact_id AND tenant_id = p_tenant_id
    ) LOOP
        SELECT id INTO v_primary_conv_id
        FROM public.conversations
        WHERE tenant_id = p_tenant_id AND channel_id = r.channel_id AND contact_id = p_primary_contact_id
        LIMIT 1;

        IF v_primary_conv_id IS NULL THEN
            -- Primary has no conversation on this channel yet: just re-point it
            UPDATE public.conversations
            SET contact_id = p_primary_contact_id
            WHERE id = r.id;
        ELSE
            -- Primary already has a conversation on this channel: move messages over, then fold state
            UPDATE public.messages
            SET conversation_id = v_primary_conv_id
            WHERE conversation_id = r.id;

            SELECT last_message_at, last_message_text, unread_count
            INTO v_dup_last_message_at, v_dup_last_message_text, v_dup_unread_count
            FROM public.conversations WHERE id = r.id;

            UPDATE public.conversations
            SET last_message_at = GREATEST(last_message_at, v_dup_last_message_at),
                last_message_text = CASE WHEN v_dup_last_message_at > last_message_at THEN v_dup_last_message_text ELSE last_message_text END,
                unread_count = unread_count + COALESCE(v_dup_unread_count, 0),
                updated_at = NOW()
            WHERE id = v_primary_conv_id;

            DELETE FROM public.conversations WHERE id = r.id;
        END IF;
    END LOOP;

    -- 3. Delete the now-empty duplicate contact
    DELETE FROM public.contacts WHERE id = p_duplicate_contact_id AND tenant_id = p_tenant_id;

    RETURN jsonb_build_object(
        'success', true,
        'primary_contact_id', p_primary_contact_id,
        'duplicate_contact_id', p_duplicate_contact_id
    );
END;
$$;
