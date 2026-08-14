import { NextResponse } from 'next/server';
import { getTeamMember, updateTeamMember, deleteTeamMember, addLog } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await getTeamMember(id);
    if (!existing) {
      return NextResponse.json({ message: 'Team member not found' }, { status: 404 });
    }

    await updateTeamMember(id, body);

    await addLog({
      user: 'Administrator',
      action: 'Team Member Updated',
      details: `Updated details for ${body.fullName || existing.fullName} (Role: ${body.role || existing.role})`,
      type: 'info',
    });

    const refreshed = await getTeamMember(id);
    return NextResponse.json(refreshed);
  } catch (error: any) {
    console.error('Failed to update team member:', error);
    return NextResponse.json({ message: error.message || 'Failed to update team member' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await getTeamMember(id);

    if (!existing) {
      return NextResponse.json({ message: 'Team member not found' }, { status: 404 });
    }

    await deleteTeamMember(id);

    await addLog({
      user: 'Administrator',
      action: 'Team Member Removed',
      details: `Removed team member ${existing.fullName} (${existing.id})`,
      type: 'warning',
    });

    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    console.error('Failed to delete team member:', error);
    return NextResponse.json({ message: error.message || 'Failed to delete team member' }, { status: 500 });
  }
}
