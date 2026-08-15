import { NextRequest, NextResponse } from 'next/server';
import { createTenantInvitation, getTenantInvitations, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';
import type { InvitationRole } from '@/types';

export const dynamic = 'force-dynamic';

const VALID_ROLES: InvitationRole[] = ['admin', 'operator', 'viewer'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GET = withApiAuth(
  async () => {
    try {
      const invitations = await getTenantInvitations();
      return NextResponse.json(invitations);
    } catch (error) {
      console.error('Failed to fetch invitations:', error);
      return NextResponse.json({ message: 'Failed to fetch invitations' }, { status: 500 });
    }
  },
  { roles: ['admin'] }
);

export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json();
      const email = (body.email || '').trim().toLowerCase();
      const role: InvitationRole = VALID_ROLES.includes(body.role) ? body.role : 'operator';

      if (!email || !EMAIL_RE.test(email)) {
        return NextResponse.json({ message: 'A valid email address is required' }, { status: 400 });
      }

      const invitation = await createTenantInvitation({ email, role, invitedBy: ctx.userId });

      const origin = request.nextUrl.origin;
      const inviteUrl = `${origin}/invite/${invitation.token}`;

      await addLog({
        user: ctx.userId || 'Administrator',
        action: 'Team Invitation Sent',
        details: `Invited ${email} as ${role}`,
        type: 'info',
      });

      return NextResponse.json({ ...invitation, inviteUrl }, { status: 201 });
    } catch (error: any) {
      console.error('Failed to create invitation:', error);
      return NextResponse.json({ message: error.message || 'Failed to create invitation' }, { status: 400 });
    }
  },
  { roles: ['admin'] }
);
