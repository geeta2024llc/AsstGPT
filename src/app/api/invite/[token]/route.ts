import { NextRequest, NextResponse } from 'next/server';
import { getPendingInvitationByToken } from '@/lib/db';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Public preview endpoint for the /invite/[token] accept page. Not behind
 * withApiAuth -- the invitee has no session yet. Returns only what the
 * accept UI needs: no tenant IDs or membership details.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = await getPendingInvitationByToken(token);

  if (!invitation) {
    return NextResponse.json({ error: 'This invitation is invalid or has expired' }, { status: 404 });
  }

  let existingAccount = false;
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin.from('users').select('id').eq('email', invitation.email).maybeSingle();
    existingAccount = !!data;
  } catch (err) {
    console.error('Failed to check for existing account on invite preview:', err);
  }

  return NextResponse.json({
    email: invitation.email,
    role: invitation.role,
    tenantName: invitation.tenantName,
    existingAccount,
  });
}
