-- ============================================================================
-- AIWhisper Phase 4: Canned Responses & Conversation Lifecycle Schema
-- Migration File: 20260814010000_canned_responses_and_lifecycle.sql
-- ============================================================================

-- 1. Create Canned Responses / Quick Reply Snippets Table
CREATE TABLE IF NOT EXISTS public.canned_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    shortcut TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'general' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uk_canned_responses_tenant_shortcut UNIQUE (tenant_id, shortcut)
);

CREATE INDEX IF NOT EXISTS idx_canned_responses_tenant_category ON public.canned_responses(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_canned_responses_tenant_shortcut ON public.canned_responses(tenant_id, shortcut);

-- 2. Extend Conversations table with status lifecycle column if not exists
ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open' NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversations_status'
    ) THEN
        ALTER TABLE public.conversations
            ADD CONSTRAINT chk_conversations_status CHECK (status IN ('open', 'resolved', 'pending'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_status ON public.conversations(tenant_id, status);

-- 3. Enable RLS on canned_responses
ALTER TABLE public.canned_responses ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policy for canned_responses
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'canned_responses' AND policyname = 'Tenant members can manage canned responses'
    ) THEN
        CREATE POLICY "Tenant members can manage canned responses"
            ON public.canned_responses
            FOR ALL
            USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));
    END IF;
END $$;
