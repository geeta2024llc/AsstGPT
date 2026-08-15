-- ============================================================================
-- AIWhisper: Super Admin Platform Layer
-- Migration File: 20260815080000_super_admin_platform.sql
--
-- Introduces a platform-level authorization boundary that is completely
-- separate from tenant RBAC (tenant_members.role / team_members.role).
-- platform_admins, platform_audit_logs, feature_flags, tenant_feature_flags,
-- and ai_usage_logs are all RLS-enabled with NO grants to anon/authenticated
-- -- they are reachable only via the service-role client
-- (getSupabaseAdmin() in src/lib/supabase.ts), so a tenant user (even a
-- tenant owner/admin) has no path to them through PostgREST.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PLATFORM ADMINS
-- ----------------------------------------------------------------------------
-- Keyed primarily by email (not user_id) because the bootstrap super admin
-- may not have a public.users row yet at migration time. user_id is
-- backfilled opportunistically once that admin authenticates.
CREATE TABLE IF NOT EXISTS public.platform_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    email TEXT NOT NULL UNIQUE,
    platform_role TEXT NOT NULL DEFAULT 'super_admin' CHECK (platform_role IN ('super_admin', 'auditor')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_platform_admins_email ON public.platform_admins(lower(email));
CREATE INDEX IF NOT EXISTS idx_platform_admins_user ON public.platform_admins(user_id);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: only the service-role key can read/write this table.

-- ----------------------------------------------------------------------------
-- 2. PLATFORM AUDIT LOGS (append-only, cross-tenant)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID,
    actor_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
    ip_address TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    result TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success', 'failure')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_date ON public.platform_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_tenant ON public.platform_audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_actor ON public.platform_audit_logs(actor_email, created_at DESC);

ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: append-only from the app's perspective, service-role only.

-- ----------------------------------------------------------------------------
-- 3. TENANT LIFECYCLE COLUMNS (suspend / reactivate / plan)
-- ----------------------------------------------------------------------------
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS suspended_reason TEXT,
    ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

-- ----------------------------------------------------------------------------
-- 4. FEATURE FLAGS (global + per-tenant override)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_flags (
    key TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT false,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tenant_feature_flags (
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    flag_key TEXT NOT NULL REFERENCES public.feature_flags(key) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, flag_key)
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_feature_flags ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies here either: flags are read server-side (via
-- getDb()/getSupabaseAdmin() in src/lib/feature-flags.ts), never directly by
-- browser clients, so tenant users never need a PostgREST grant on these.

-- Seed a couple of illustrative flags so the admin UI isn't empty on first load.
INSERT INTO public.feature_flags (key, enabled, description) VALUES
    ('voice_ai_responses', true, 'Allow agents to reply with synthetic voice notes'),
    ('proactive_reengagement', true, 'Automatic follow-up messages on stale conversations')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. AI USAGE & COST LOG
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT,
    request_type TEXT NOT NULL DEFAULT 'chat' CHECK (request_type IN ('chat', 'transcription', 'vision')),
    input_tokens INTEGER,
    output_tokens INTEGER,
    estimated_cost_usd NUMERIC(12, 6),
    latency_ms INTEGER,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_tenant_date ON public.ai_usage_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_provider_date ON public.ai_usage_logs(provider, created_at DESC);

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: written by the backend via service-role, read
-- only by the super-admin panel in this pass (no tenant self-serve view yet).

-- ----------------------------------------------------------------------------
-- 6. TENANT ACTIVE-STATUS RPC (used by middleware.ts for suspension checks)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_tenant_active(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
    SELECT COALESCE((SELECT is_active FROM public.tenants WHERE id = p_tenant_id), true);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ----------------------------------------------------------------------------
-- 7. BOOTSTRAP SUPER ADMIN
-- ----------------------------------------------------------------------------
INSERT INTO public.platform_admins (email, platform_role)
VALUES ('geeta2024llc@gmail.com', 'super_admin')
ON CONFLICT (email) DO NOTHING;
