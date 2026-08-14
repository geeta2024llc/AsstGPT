import { NextResponse } from 'next/server';
import { getHandoffRule, updateHandoffRule, deleteHandoffRule, addLog } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rule = await getHandoffRule(id);
    if (!rule) {
      return NextResponse.json({ message: 'Handoff rule not found' }, { status: 404 });
    }
    return NextResponse.json(rule);
  } catch (error) {
    console.error('Failed to get handoff rule:', error);
    return NextResponse.json({ message: 'Failed to get handoff rule' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await getHandoffRule(id);
    if (!existing) {
      return NextResponse.json({ message: 'Handoff rule not found' }, { status: 404 });
    }

    await updateHandoffRule(id, body);

    await addLog({
      user: 'Admin',
      action: 'Handoff Rule Updated',
      details: `Updated rule "${body.name || existing.name}"`,
      type: 'info',
    });

    const updated = await getHandoffRule(id);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed to update handoff rule:', error);
    return NextResponse.json({ message: 'Failed to update handoff rule' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await getHandoffRule(id);
    if (!existing) {
      return NextResponse.json({ message: 'Handoff rule not found' }, { status: 404 });
    }

    await deleteHandoffRule(id);

    await addLog({
      user: 'Admin',
      action: 'Handoff Rule Deleted',
      details: `Deleted handoff rule "${existing.name}"`,
      type: 'warning',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete handoff rule:', error);
    return NextResponse.json({ message: 'Failed to delete handoff rule' }, { status: 500 });
  }
}
