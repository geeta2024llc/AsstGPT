-- ============================================================================
-- AIWhisper Phase H: Platform Admin Hardening
--
-- Two correctness fixes found while auditing the super-admin platform layer
-- (20260815080000_super_admin_platform.sql):
-- ============================================================================

-- 1. check_tenant_active() must fail CLOSED for an unrecognized tenant_id,
--    matching the fail-closed philosophy middleware.ts already uses for the
--    primary auth check. Previously COALESCE(...) defaulted to true, so a
--    malformed or deleted tenant_id would read as "active" instead of being
--    blocked.
CREATE OR REPLACE FUNCTION public.check_tenant_active(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
    SELECT COALESCE((SELECT is_active FROM public.tenants WHERE id = p_tenant_id), false);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 2. platform_admins.email must be unique CASE-INSENSITIVELY: every lookup
--    (platform-admin-guard.ts) lowercases the incoming email before
--    comparing, but the original UNIQUE constraint was case-sensitive, so a
--    row inserted with different casing than a lookup would either silently
--    fail to match (locking a legitimate admin out) or coexist ambiguously
--    with a same-address row of different case.
UPDATE public.platform_admins SET email = lower(email) WHERE email <> lower(email);
ALTER TABLE public.platform_admins DROP CONSTRAINT IF EXISTS platform_admins_email_key;
DROP INDEX IF EXISTS idx_platform_admins_email;
CREATE UNIQUE INDEX idx_platform_admins_email ON public.platform_admins (lower(email));
