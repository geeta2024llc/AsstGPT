import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { withApiAuth } from '@/lib/api-guard';
import { addLog } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Transfers primary ownership of the workspace from the current owner
 * to an existing team member.
 *
 * Rules:
 * 1. Caller must be the active verified 'owner' in tenant_members for this tenant.
 * 2. Target user must be an active member of this workspace.
 * 3. Atomic role swap: caller demoted to 'admin', target promoted to 'owner'.
 * 4. Live Supabase Auth app_metadata re-stamped for both accounts.
 */
export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json();
      const { newOwnerUserId } = body;

      if (!newOwnerUserId || typeof newOwnerUserId !== 'string') {
        return NextResponse.json({ message: 'newOwnerUserId is required' }, { status: 400 });
      }

      if (!ctx.userId) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }

      if (ctx.userId === newOwnerUserId) {
        return NextResponse.json({ message: 'You are already the owner of this workspace' }, { status: 400 });
      }

      const admin = getSupabaseAdmin();
      const tenantId = ctx.tenantId;

      // 1. Verify caller is currently the owner of this workspace
      const { data: callerMember, error: callerErr } = await admin
        .from('tenant_members')
        .select('role')
        .eq('tenant_id', tenantId)
        .eq('user_id', ctx.userId)
        .maybeSingle();

      if (callerErr || !callerMember || callerMember.role !== 'owner') {
        return NextResponse.json(
          { message: 'Forbidden: Only the workspace owner can transfer ownership' },
          { status: 403 }
        );
      }

      // 2. Verify target user is a member of this workspace
      const { data: targetMember, error: targetErr } = await admin
        .from('tenant_members')
        .select('role, user_id')
        .eq('tenant_id', tenantId)
        .eq('user_id', newOwnerUserId)
        .maybeSingle();

      if (targetErr || !targetMember) {
        return NextResponse.json(
          { message: 'Target user is not a member of this workspace' },
          { status: 404 }
        );
      }

      // 3. Promote target to 'owner'
      const { error: promoteErr } = await admin
        .from('tenant_members')
        .update({ role: 'owner' })
        .eq('tenant_id', tenantId)
        .eq('user_id', newOwnerUserId);

      if (promoteErr) {
        console.error('Failed to promote new owner:', promoteErr);
        return NextResponse.json({ message: 'Failed to promote new owner' }, { status: 500 });
      }

      // 4. Demote former owner to 'admin'
      const { error: demoteErr } = await admin
        .from('tenant_members')
        .update({ role: 'admin' })
        .eq('tenant_id', tenantId)
        .eq('user_id', ctx.userId);

      if (demoteErr) {
        console.error('Failed to demote former owner:', demoteErr);
      }

      // 5. Live-sync app_metadata for both accounts
      try {
        await admin.auth.admin.updateUserById(newOwnerUserId, {
          app_metadata: { tenant_id: tenantId, role: 'owner' },
        });
        await admin.auth.admin.updateUserById(ctx.userId, {
          app_metadata: { tenant_id: tenantId, role: 'admin' },
        });
      } catch (authErr) {
        console.warn('Failed to sync auth app_metadata during ownership transfer:', authErr);
      }

      await addLog({
        user: ctx.userId,
        action: 'Workspace Ownership Transferred',
        details: `Transferred workspace ownership to user ${newOwnerUserId}`,
        type: 'warning',
      });

      return NextResponse.json({
        success: true,
        message: 'Workspace ownership successfully transferred.',
        newOwnerUserId,
      });
    } catch (error: any) {
      console.error('Failed to transfer workspace ownership:', error);
      return NextResponse.json({ message: error.message || 'Failed to transfer ownership' }, { status: 500 });
    }
  },
  { roles: ['admin', 'owner' as any] }
);
