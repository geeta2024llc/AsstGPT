import { NextRequest, NextResponse } from 'next/server';
import { deleteConversationNote, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export const DELETE = withApiAuth<RouteContext>(
  async (_request: NextRequest, ctx, { params }) => {
    try {
      const { id } = await params;
      await deleteConversationNote(id);

      await addLog({
        user: ctx.userId || 'Agent',
        action: 'Internal Note Deleted',
        details: `Deleted internal note ${id}`,
        type: 'info',
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('Failed to delete conversation note:', error);
      return NextResponse.json({ message: 'Failed to delete conversation note' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);
