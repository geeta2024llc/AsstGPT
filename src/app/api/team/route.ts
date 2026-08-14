import { NextResponse } from 'next/server';
import { getTeamMembers, createTeamMember, addLog } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const members = await getTeamMembers();
    return NextResponse.json(members);
  } catch (error) {
    console.error('Failed to fetch team members:', error);
    return NextResponse.json({ message: 'Failed to fetch team members' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { fullName, email, avatarUrl, role = 'agent', status = 'online', assignedQueues = [] } = body;

    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      return NextResponse.json({ message: 'Full name is required' }, { status: 400 });
    }

    const newMember = await createTeamMember({
      fullName: fullName.trim(),
      email: email ? email.trim() : undefined,
      avatarUrl: avatarUrl || undefined,
      role,
      status,
      assignedQueues,
    });

    await addLog({
      user: 'Administrator',
      action: 'Team Member Created',
      details: `Added ${newMember.fullName} with role "${newMember.role}"`,
      type: 'info',
    });

    return NextResponse.json(newMember, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create team member:', error);
    return NextResponse.json({ message: error.message || 'Failed to create team member' }, { status: 500 });
  }
}
