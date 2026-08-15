-- ============================================================================
-- AIWhisper Phase G: Tenant / Workspace Settings
--
-- Adds the company-profile fields a real multi-tenant SaaS needs per
-- workspace (branding, timezone, business info, notification preferences).
-- Billing/plan fields (plan, is_active, suspended_at/reason) already exist
-- from 20260815080000_super_admin_platform.sql and are surfaced here
-- read-only -- self-serve plan changes are a later, separate piece of work.
-- ============================================================================

ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS logo_url TEXT,
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC',
    ADD COLUMN IF NOT EXISTS business_description TEXT,
    ADD COLUMN IF NOT EXISTS support_email TEXT,
    ADD COLUMN IF NOT EXISTS notification_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
