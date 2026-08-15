import { NextRequest, NextResponse } from 'next/server';
import { getPendingInvitationByToken, claimInvitation, revertInvitationClaim } from '@/lib/db';
import { supabase, getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Accepts an invitation for someone who does NOT already have an account:
 * creates the Auth user with the invited tenant_id/role stamped into
 * app_metadata, links tenant_members, and signs them in. Existing-account
 * invitees use /api/team/invitations/join instead (proves ownership via an
 * authenticated session rather than the token alone).
 *
 * The invitation is atomically claimed (pending -> accepted) BEFORE any
 * account/membership is created, so a token can never be used twice
 * (including concurrently) and a revoked/already-used token is rejected
 * up front. If any step after the claim fails, the claim is released so
 * the invitation can be retried instead of being stranded.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let body: { fullName?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const fullName = body.fullName?.trim();
  const password = body.password;
  if (!fullName || !password) {
    return NextResponse.json({ error: 'fullName and password are required' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const invitation = await getPendingInvitationByToken(token);
  if (!invitation) {
    return NextResponse.json({ error: 'This invitation is invalid or has expired' }, { status: 404 });
  }

  const claimed = await claimInvitation(invitation.id);
  if (!claimed) {
    return NextResponse.json({ error: 'This invitation has already been used' }, { status: 409 });
  }

  const admin = getSupabaseAdmin();
  let createdUserId: string | null = null;

  try {
    const { data: existing } = await admin.from('users').select('id').eq('email', invitation.email).maybeSingle();
    if (existing) {
      await revertInvitationClaim(invitation.id);
      return NextResponse.json(
        { error: 'An account already exists for this email. Please log in to accept this invitation.', existingAccount: true },
        { status: 409 }
      );
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: invitation.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
      app_metadata: { tenant_id: invitation.tenantId, role: invitation.role },
    });

    if (createErr || !created?.user) {
      await revertInvitationClaim(invitation.id);
      return NextResponse.json({ error: createErr?.message || 'Failed to create account' }, { status: 400 });
    }
    const userId = created.user.id;
    createdUserId = userId;

    const { error: memberErr } = await admin
      .from('tenant_members')
      .insert({ tenant_id: invitation.tenantId, user_id: userId, role: invitation.role });

    if (memberErr) {
      console.error('tenant_members insert failed for invite accept, rolling back:', memberErr);
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      await revertInvitationClaim(invitation.id);
      return NextResponse.json({ error: 'Failed to finish joining the workspace' }, { status: 500 });
    }

    // Membership is now durably created -- the invitation was validly
    // consumed regardless of whether the sign-in step below succeeds.
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
      email: invitation.email,
      password,
    });
    if (signInErr || !signInData?.session) {
      return NextResponse.json({ requiresLogin: true, tenantName: invitation.tenantName });
    }

    return NextResponse.json({
      session: {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        expires_at: signInData.session.expires_at,
      },
      tenantName: invitation.tenantName,
    });
  } catch (err) {
    console.error('Unhandled exception during invitation accept, reverting claim:', err);
    if (createdUserId) {
      await admin.auth.admin.deleteUser(createdUserId).catch(() => {});
    }
    await revertInvitationClaim(invitation.id).catch(() => {});
    return NextResponse.json({ error: 'An unexpected error occurred while accepting invitation' }, { status: 500 });
  }
}
