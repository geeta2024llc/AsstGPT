import { NextResponse } from 'next/server';
import { deleteConversationNote, addLog } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteConversationNote(id);

    await addLog({
      user: 'Agent',
      action: 'Internal Note Deleted',
      details: `Deleted internal note ${id}`,
      type: 'info',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete conversation note:', error);
    return NextResponse.json({ message: 'Failed to delete conversation note' }, { status: 500 });
  }
}
