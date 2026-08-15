import { NextRequest, NextResponse } from 'next/server';
import { getPendingInvitationByToken, claimInvitation, revertInvitationClaim, addLog } from '@/lib/db';
import { getSupabaseAdmin } from '@/lib/supabase';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

/**
 * Attaches the CURRENTLY authenticated user to an invited tenant. Used when
 * the invited email already has an account: the requester must already be
 * signed in as that email (proven via their own session, not the invite
 * token alone) before we grant them access to the new workspace.
 *
 * Like the /accept route, the invitation is atomically claimed before any
 * membership mutation so the token cannot be reused or raced.
 */
export const POST = withApiAuth(async (request: NextRequest, ctx) => {
  try {
    const { token } = await request.json();
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ message: 'Missing invitation token' }, { status: 400 });
    }
    if (!ctx.userId) {
      return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
    }

    const invitation = await getPendingInvitationByToken(token);
    if (!invitation) {
      return NextResponse.json({ message: 'This invitation is invalid or has expired' }, { status: 404 });
    }

    const admin = getSupabaseAdmin();
    const { data: userData, error: userErr } = await admin.auth.admin.getUserById(ctx.userId);
    if (userErr || !userData?.user?.email) {
      return NextResponse.json({ message: 'Unable to verify account email' }, { status: 500 });
    }

    if (userData.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return NextResponse.json(
        { message: `This invitation was sent to ${invitation.email}. Sign in with that account to accept it.` },
        { status: 403 }
      );
    }

    const claimed = await claimInvitation(invitation.id);
    if (!claimed) {
      return NextResponse.json({ message: 'This invitation has already been used' }, { status: 409 });
    }

    const { data: preexisting } = await admin
      .from('tenant_members')
      .select('user_id')
      .eq('tenant_id', invitation.tenantId)
      .eq('user_id', ctx.userId)
      .maybeSingle();
    const wasAlreadyMember = !!preexisting;

    const { error: memberErr } = await admin
      .from('tenant_members')
      .upsert(
        { tenant_id: invitation.tenantId, user_id: ctx.userId, role: invitation.role },
        { onConflict: 'tenant_id,user_id' }
      );
    if (memberErr) {
      console.error('Failed to add tenant_members row for invite join:', memberErr);
      await revertInvitationClaim(invitation.id);
      return NextResponse.json({ message: 'Failed to join workspace' }, { status: 500 });
    }

    const { error: metaErr } = await admin.auth.admin.updateUserById(ctx.userId, {
      app_metadata: { tenant_id: invitation.tenantId, role: invitation.role },
    });
    if (metaErr) {
      console.error('Failed to stamp app_metadata for invite join:', metaErr);
      if (!wasAlreadyMember) {
        try {
          await admin
            .from('tenant_members')
            .delete()
            .eq('tenant_id', invitation.tenantId)
            .eq('user_id', ctx.userId);
        } catch {
          // best-effort cleanup
        }
      }
      await revertInvitationClaim(invitation.id);
      return NextResponse.json({ message: 'Failed to activate workspace access' }, { status: 500 });
    }

    await addLog({
      user: ctx.userId,
      action: 'Joined Workspace via Invitation',
      details: `Joined tenant ${invitation.tenantId} as ${invitation.role}`,
      type: 'info',
    });

    return NextResponse.json({ tenantId: invitation.tenantId, tenantName: invitation.tenantName });
  } catch (error: any) {
    console.error('Failed to join invited tenant:', error);
    return NextResponse.json({ message: error.message || 'Failed to join workspace' }, { status: 500 });
  }
});
