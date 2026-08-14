-- ============================================================================
-- AIWhisper Phase 2: Internal Team Notes & Realtime Publication Schema
-- Migration File: 20260814020000_internal_notes.sql
-- ============================================================================

-- 1. Create Conversation Notes (Internal Team Notes) Table
CREATE TABLE IF NOT EXISTS public.conversation_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL,
    user_id TEXT,
    user_name TEXT NOT NULL,
    user_avatar TEXT,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_notes_tenant_chat ON public.conversation_notes(tenant_id, chat_id, created_at ASC);

-- 2. Enable Row Level Security
ALTER TABLE public.conversation_notes ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policy for conversation_notes
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'conversation_notes' AND policyname = 'Tenant members can manage conversation notes'
    ) THEN
        CREATE POLICY "Tenant members can manage conversation notes"
            ON public.conversation_notes
            FOR ALL
            USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));
    END IF;
END $$;

-- 4. Enable Supabase Realtime for messages, conversations, and conversation_notes
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_notes;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END IF;
END $$;
