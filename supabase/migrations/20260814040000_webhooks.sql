-- ============================================================================
-- AIWhisper Phase 4: Outbound Webhooks & CRM Integration Schema
-- Migration File: 20260814040000_webhooks.sql
-- ============================================================================

-- 1. Create Webhooks Table
CREATE TABLE IF NOT EXISTS public.webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events TEXT[] NOT NULL DEFAULT '{}'::text[],
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    last_triggered_at TIMESTAMPTZ,
    last_status_code INTEGER,
    failure_count INTEGER DEFAULT 0 NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhooks_tenant_active ON public.webhooks(tenant_id, is_active);

-- 2. Enable Row Level Security
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policy for webhooks
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'webhooks' AND policyname = 'Tenant members can manage webhooks'
    ) THEN
        CREATE POLICY "Tenant members can manage webhooks"
            ON public.webhooks
            FOR ALL
            USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));
    END IF;
END $$;
