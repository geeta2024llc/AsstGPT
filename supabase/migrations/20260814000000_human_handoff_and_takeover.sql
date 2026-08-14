-- ============================================================================
-- AIWhisper Phase 3: Human Agent Handoff & Live Takeover Schema
-- Migration File: 20260814000000_human_handoff_and_takeover.sql
-- ============================================================================

-- 1. Create Handoff & Routing Rules table
CREATE TABLE IF NOT EXISTS public.handoff_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '' NOT NULL,
    is_enabled BOOLEAN DEFAULT true NOT NULL,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('confidence_threshold', 'intent_detected', 'keyword_match', 'consecutive_fallback')),
    conditions JSONB DEFAULT '{}'::jsonb NOT NULL,
    actions JSONB DEFAULT '{}'::jsonb NOT NULL,
    priority INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_handoff_rules_tenant_priority ON public.handoff_rules(tenant_id, priority DESC);
CREATE INDEX IF NOT EXISTS idx_handoff_rules_tenant_enabled ON public.handoff_rules(tenant_id, is_enabled);

-- 2. Extend Conversations table for Manual Pause / Live Takeover & Human Assignment
ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS is_bot_paused BOOLEAN DEFAULT false NOT NULL,
    ADD COLUMN IF NOT EXISTS assigned_user_id TEXT,
    ADD COLUMN IF NOT EXISTS handoff_reason TEXT,
    ADD COLUMN IF NOT EXISTS handoff_metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    ADD COLUMN IF NOT EXISTS handoff_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_bot_paused ON public.conversations(tenant_id, is_bot_paused);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned_user ON public.conversations(tenant_id, assigned_user_id);

-- 3. Enable RLS on handoff_rules
ALTER TABLE public.handoff_rules ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policy for handoff_rules
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'handoff_rules' AND policyname = 'Tenant members can manage handoff rules'
    ) THEN
        CREATE POLICY "Tenant members can manage handoff rules"
            ON public.handoff_rules
            FOR ALL
            USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));
    END IF;
END $$;
