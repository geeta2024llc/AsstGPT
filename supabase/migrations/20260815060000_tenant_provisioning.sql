-- ============================================================================
-- AIWhisper Phase D: Tenant Signup Provisioning
-- Migration File: 20260815060000_tenant_provisioning.sql
--
-- Prior to this migration, public.users was never populated when a new
-- Supabase Auth user was created, which meant tenant_members inserts
-- (FK -> public.users) would fail for any signup/invite flow. This trigger
-- keeps public.users in sync with auth.users for every account creation path
-- (self-serve signup, admin-created invites, OAuth, etc).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, full_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
    )
    ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email,
            updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
