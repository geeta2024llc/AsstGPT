import { NextRequest, NextResponse } from 'next/server';
import { getTeamMember, updateTeamMember, deleteTeamMember, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApiAuth<RouteContext>(
  async (_request: NextRequest, _ctx, { params }) => {
    try {
      const { id } = await params;
      const member = await getTeamMember(id);

      if (!member) {
        return NextResponse.json({ message: 'Team member not found' }, { status: 404 });
      }

      return NextResponse.json(member);
    } catch (error) {
      console.error('Failed to fetch team member:', error);
      return NextResponse.json({ message: 'Failed to fetch team member' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

export const PUT = withApiAuth<RouteContext>(
  async (request: NextRequest, ctx, { params }) => {
    try {
      const { id } = await params;
      const body = await request.json();

      const existing = await getTeamMember(id);
      if (!existing) {
        return NextResponse.json({ message: 'Team member not found' }, { status: 404 });
      }

      await updateTeamMember(
        id,
        {
          role: body.role,
          status: body.status,
          assignedQueues: body.assignedQueues,
          avatarUrl: body.avatarUrl,
        },
        { confirmLastAdmin: !!body.confirmLastAdmin }
      );

      await addLog({
        user: ctx.userId || 'Administrator',
        action: 'Team Member Updated',
        details: `Updated ${existing.fullName} (Role: ${body.role || existing.role})`,
        type: 'info',
      });

      const refreshed = await getTeamMember(id);
      return NextResponse.json(refreshed);
    } catch (error: any) {
      console.error('Failed to update team member:', error);
      return NextResponse.json({ message: error.message || 'Failed to update team member' }, { status: 400 });
    }
  },
  { roles: ['admin'] }
);

export const DELETE = withApiAuth<RouteContext>(
  async (request: NextRequest, ctx, { params }) => {
    try {
      const { id } = await params;
      const url = new URL(request.url);
      const confirmLastAdmin = url.searchParams.get('confirmLastAdmin') === 'true';

      const existing = await getTeamMember(id);
      if (!existing) {
        return NextResponse.json({ message: 'Team member not found' }, { status: 404 });
      }

      await deleteTeamMember(id, { confirmLastAdmin });

      await addLog({
        user: ctx.userId || 'Administrator',
        action: 'Team Member Removed',
        details: `Removed team member ${existing.fullName} (${existing.id})`,
        type: 'warning',
      });

      return NextResponse.json({ success: true, id });
    } catch (error: any) {
      console.error('Failed to delete team member:', error);
      return NextResponse.json({ message: error.message || 'Failed to delete team member' }, { status: 400 });
    }
  },
  { roles: ['admin'] }
);
