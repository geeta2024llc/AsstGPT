-- ============================================================================
-- AIWhisper Phase I: Atomic Team Member Role/Removal Guard
--
-- updateTeamMember()/deleteTeamMember() previously enforced "don't remove
-- the last non-owner admin" via a separate SELECT (count other admins) then
-- a separate UPDATE/DELETE. Two concurrent requests demoting/removing two
-- different admins could each pass the check independently (each sees the
-- other still present) and both commit, leaving zero non-owner admins --
-- defeating the guard's own guarantee. This migration moves the whole
-- check-then-act sequence into a single function so a row lock on the
-- tenant's membership set makes it genuinely atomic.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.change_team_member_atomic(
    p_tenant_id UUID,
    p_user_id UUID,
    p_action TEXT,                              -- 'update' or 'delete'
    p_new_role TEXT DEFAULT NULL,
    p_new_status TEXT DEFAULT NULL,
    p_new_assigned_queues TEXT[] DEFAULT NULL,
    p_new_avatar_url TEXT DEFAULT NULL,
    p_confirm_last_admin BOOLEAN DEFAULT FALSE
)
RETURNS TEXT                                    -- NULL on success, an error message on failure
AS $$
DECLARE
    v_current_role TEXT;
    v_other_admin_count INT;
BEGIN
    IF p_action NOT IN ('update', 'delete') THEN
        RETURN 'Invalid action';
    END IF;

    -- Lock this tenant's membership rows for the duration of the
    -- transaction so a concurrent call for the same tenant must wait and
    -- then re-evaluate against up-to-date data, instead of racing.
    PERFORM 1 FROM public.tenant_members WHERE tenant_id = p_tenant_id FOR UPDATE;

    SELECT role INTO v_current_role
    FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND user_id = p_user_id;

    IF v_current_role IS NULL THEN
        RETURN 'Team member not found in this workspace';
    END IF;

    IF v_current_role = 'owner' THEN
        IF p_action = 'delete' THEN
            RETURN 'The workspace owner cannot be removed';
        ELSE
            RETURN 'The workspace owner''s role cannot be changed here';
        END IF;
    END IF;

    IF p_action = 'update' AND p_new_role = 'owner' THEN
        RETURN 'Ownership cannot be granted through this action';
    END IF;

    -- Last-admin guard: only matters if this member currently holds admin
    -- and the action would remove their admin standing.
    IF v_current_role = 'admin' AND (p_action = 'delete' OR (p_new_role IS NOT NULL AND p_new_role <> 'admin')) THEN
        SELECT count(*) INTO v_other_admin_count
        FROM public.tenant_members
        WHERE tenant_id = p_tenant_id AND role = 'admin' AND user_id <> p_user_id;

        IF v_other_admin_count = 0 AND NOT p_confirm_last_admin THEN
            IF p_action = 'delete' THEN
                RETURN 'CONFIRMATION_REQUIRED_LAST_ADMIN: This user is the last remaining administrator (aside from the owner). Confirmation is required to remove them.';
            ELSE
                RETURN 'CONFIRMATION_REQUIRED_LAST_ADMIN: This user is the last remaining administrator (aside from the owner). Confirmation is required to demote them.';
            END IF;
        END IF;
    END IF;

    IF p_action = 'delete' THEN
        DELETE FROM public.tenant_members WHERE tenant_id = p_tenant_id AND user_id = p_user_id;
    ELSE
        UPDATE public.tenant_members SET
            role = COALESCE(p_new_role, role),
            status = COALESCE(p_new_status, status),
            assigned_queues = COALESCE(p_new_assigned_queues, assigned_queues),
            avatar_url = COALESCE(p_new_avatar_url, avatar_url)
        WHERE tenant_id = p_tenant_id AND user_id = p_user_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
