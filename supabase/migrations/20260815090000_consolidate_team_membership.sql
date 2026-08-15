-- ============================================================================
-- AIWhisper Phase F: Consolidate Team Membership onto tenant_members
--
-- team_members (20260814070000_team_rbac.sql) was a decorative roster:
-- creating a row there never created a login account or granted tenant
-- access, which diverged from tenant_members -- the table RLS and
-- middleware.ts actually trust for real access. This migration makes
-- tenant_members the single source of truth for who belongs to a tenant,
-- folds the roster's presentation fields (avatar, presence status, queue
-- routing) onto it, and removes the decorative table.
-- ============================================================================

-- 1. Fold roster-only presentation fields onto tenant_members.
ALTER TABLE public.tenant_members
    ADD COLUMN IF NOT EXISTS avatar_url TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'away', 'offline')),
    ADD COLUMN IF NOT EXISTS assigned_queues TEXT[] NOT NULL DEFAULT '{}'::text[];

-- 2. Re-tighten the role vocabulary to exactly what api-guard.ts enforces,
--    plus 'owner' for the signup-time tenant creator. ('member' was added
--    in 20260815070000_tenant_invitations.sql as a hedge and is removed
--    again here now that the real vocabulary is settled.)
ALTER TABLE public.tenant_members DROP CONSTRAINT IF EXISTS tenant_members_role_check;
ALTER TABLE public.tenant_members
    ADD CONSTRAINT tenant_members_role_check
    CHECK (role IN ('owner', 'admin', 'operator', 'viewer'));

-- 3. Best-effort backfill: where a legacy team_members row's email matches a
--    real tenant_members row for the same tenant, carry over its
--    presentation fields. Legacy rows with no matching real account cannot
--    be migrated -- they were never backed by a login, which is exactly the
--    gap this migration closes.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'team_members') THEN
        UPDATE public.tenant_members tm
        SET avatar_url = COALESCE(tm.avatar_url, legacy.avatar_url),
            status = legacy.status,
            assigned_queues = legacy.assigned_queues
        FROM public.team_members legacy
        JOIN public.users u ON lower(u.email) = lower(legacy.email)
        WHERE legacy.tenant_id = tm.tenant_id
          AND u.id = tm.user_id;
    END IF;
END $$;

-- 4. Drop the decorative roster table entirely -- tenant_members is now the
--    single source of truth for tenant membership.
DROP TABLE IF EXISTS public.team_members;
