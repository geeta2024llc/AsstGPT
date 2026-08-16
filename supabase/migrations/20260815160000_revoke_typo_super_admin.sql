-- ============================================================================
-- AIWhisper Phase I: Revoke stale platform_admins row for the typo-variant
-- 'gita2024llc@gmail.com' (one character removed from the real bootstrap
-- account, 'geeta2024llc@gmail.com')
--
-- This migration's sibling code change (platform-admin-guard.ts) removed
-- both hardcoded literal emails from the auto-bootstrap allowlist -- that
-- only stops the row from being (re)created, it does not retroactively
-- revoke a row that was already inserted. A live query confirmed
-- gita2024llc@gmail.com currently holds an active (non-revoked)
-- super_admin row. Whether that address is genuinely controlled by the
-- workspace owner or was registered by an unrelated third party who
-- noticed the typo, hardcoded bootstrap identities have no place granting
-- standing platform access -- revoke it here, matching the precedent set
-- by 20260815130000_revoke_stale_dosm_super_admin.sql for the same class
-- of incident.
-- ============================================================================

UPDATE public.platform_admins
SET revoked_at = now()
WHERE lower(email) = 'gita2024llc@gmail.com'
  AND revoked_at IS NULL;
