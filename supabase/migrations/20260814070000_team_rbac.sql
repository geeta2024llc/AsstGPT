-- ============================================================================
-- AIWhisper Phase C: Multi-User Team Roles & Access Control (RBAC) Schema
-- Migration File: 20260814070000_team_rbac.sql
-- ============================================================================

-- 1. Create team_members table
CREATE TABLE IF NOT EXISTS public.team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT,
    avatar_url TEXT,
    role TEXT DEFAULT 'agent' CHECK (role IN ('admin', 'agent', 'viewer')) NOT NULL,
    status TEXT DEFAULT 'online' CHECK (status IN ('online', 'away', 'offline')) NOT NULL,
    assigned_queues TEXT[] DEFAULT '{}'::text[] NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 2. Index on tenant and role
CREATE INDEX IF NOT EXISTS idx_team_members_tenant_role ON public.team_members(tenant_id, role);

-- 3. Enable Row Level Security
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policy
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'team_members' AND policyname = 'Tenant members can manage team members'
    ) THEN
        CREATE POLICY "Tenant members can manage team members"
            ON public.team_members
            FOR ALL
            USING (tenant_id IN (SELECT public.get_user_tenant_ids(auth.uid())));
    END IF;
END $$;
