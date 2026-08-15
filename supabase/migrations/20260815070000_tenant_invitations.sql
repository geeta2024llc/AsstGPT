-- ============================================================================
-- AIWhisper Phase E: Real Team Invitations
-- Migration File: 20260815070000_tenant_invitations.sql
--
-- The existing `team_members` table (20260814070000_team_rbac.sql) is a
-- roster/directory only -- adding a row there never creates a login account
-- or grants tenant access. This migration adds the real invite-by-email
-- mechanism that provisions actual Supabase Auth access via tenant_members.
-- ============================================================================

-- 1. Widen tenant_members.role to the same RBAC vocabulary enforced by
--    api-guard.ts (admin/operator/viewer), while keeping 'owner' for the
--    signup-time tenant creator. This lets an invitation's role be written
--    straight into tenant_members without a second translation table.
ALTER TABLE public.tenant_members DROP CONSTRAINT IF EXISTS tenant_members_role_check;
ALTER TABLE public.tenant_members
    ADD CONSTRAINT tenant_members_role_check
    CHECK (role IN ('owner', 'admin', 'operator', 'viewer', 'member'));

-- 2. Invitations table
CREATE TABLE IF NOT EXISTS public.tenant_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator', 'viewer')),
    token TEXT NOT NULL UNIQUE,
    invited_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ
);

-- Only one pending invite per (tenant, email) at a time; revoked/expired/accepted
-- rows are kept for history and don't block re-inviting.
CREATE UNIQUE INDEX IF NOT EXISTS uk_tenant_invitations_pending
    ON public.tenant_invitations (tenant_id, lower(email))
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_tenant_invitations_tenant ON public.tenant_invitations(tenant_id);

ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'tenant_invitations' AND policyname = 'Tenant members can manage invitations'
    ) THEN
        CREATE POLICY "Tenant members can manage invitations"
            ON public.tenant_invitations
            FOR ALL TO authenticated
            USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())))
            WITH CHECK (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));
    END IF;
END $$;
