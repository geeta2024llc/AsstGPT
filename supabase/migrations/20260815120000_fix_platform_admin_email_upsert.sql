-- ============================================================================
-- AIWhisper Phase H-fix: Restore platform_admins ON CONFLICT (email) upserts
--
-- 20260815110000_platform_admin_hardening.sql replaced the plain
-- UNIQUE(email) constraint with a unique index on lower(email) to close a
-- case-sensitivity bug. That broke every `.upsert(..., { onConflict: 'email' })`
-- call site (e.g. tests/suites/super_admin.test.ts, and any future
-- "seed/find-or-create a platform admin by email" code), because PostgREST
-- resolves onConflict targets by exact constraint/column match and no
-- longer found one on the bare `email` column.
--
-- Fix: restore the plain UNIQUE(email) constraint (so onConflict:'email'
-- works again) and instead guarantee case-insensitive uniqueness by
-- normalizing email to lowercase on every write via a trigger. With storage
-- guaranteed lowercase, the case-sensitive constraint is effectively
-- case-insensitive in practice, and every existing `.eq('email', ...)`
-- lookup (which already lowercases its input) keeps working.
-- ============================================================================

ALTER TABLE public.platform_admins DROP CONSTRAINT IF EXISTS platform_admins_email_key;
DROP INDEX IF EXISTS idx_platform_admins_email;

ALTER TABLE public.platform_admins ADD CONSTRAINT platform_admins_email_key UNIQUE (email);

CREATE OR REPLACE FUNCTION public.normalize_platform_admin_email()
RETURNS TRIGGER AS $$
BEGIN
    NEW.email := lower(NEW.email);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalize_platform_admin_email ON public.platform_admins;
CREATE TRIGGER trg_normalize_platform_admin_email
    BEFORE INSERT OR UPDATE ON public.platform_admins
    FOR EACH ROW EXECUTE FUNCTION public.normalize_platform_admin_email();
