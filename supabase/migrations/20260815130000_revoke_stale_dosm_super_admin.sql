-- ============================================================================
-- AIWhisper Phase H-fix: Revoke stale platform_admins row for
-- asst.dosm.opl@gmail.com
--
-- 648dfb0 removed this email from the auto-bootstrap allowlist in
-- platform-admin-guard.ts, but that only stops the row from being
-- (re)created -- it does not retroactively revoke the platform_admins row
-- that was already inserted for this account before the fix landed. The
-- account's actual tenant role is admin/owner (tenant_members.role), not a
-- platform-wide super admin, so it should route to the ordinary workspace
-- panel rather than /super-admin.
-- ============================================================================

UPDATE public.platform_admins
SET revoked_at = now()
WHERE lower(email) = 'asst.dosm.opl@gmail.com'
  AND revoked_at IS NULL;
