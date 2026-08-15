import { NextResponse } from 'next/server';
import { getTeamMembers } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async () => {
    try {
      const members = await getTeamMembers();
      return NextResponse.json(members);
    } catch (error) {
      console.error('Failed to fetch team members:', error);
      return NextResponse.json({ message: 'Failed to fetch team members' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

// Members are provisioned exclusively through invitation acceptance now
// (tenant_members is the single source of truth for tenant access), so
// there is no direct "create a team member" action anymore.
export const POST = withApiAuth(
  async () => {
    return NextResponse.json(
      { message: 'Team members can no longer be created directly. Send an invitation via POST /api/team/invitations instead.' },
      { status: 410 }
    );
  },
  { roles: ['admin'] }
);
