import { NextRequest, NextResponse } from 'next/server';
import { getCannedResponse, updateCannedResponse, deleteCannedResponse, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApiAuth<RouteContext>(
  async (_request: NextRequest, _ctx, { params }) => {
    try {
      const { id } = await params;
      const item = await getCannedResponse(id);
      if (!item) {
        return NextResponse.json({ message: 'Canned response not found' }, { status: 404 });
      }
      return NextResponse.json(item);
    } catch (error) {
      console.error('Failed to get canned response:', error);
      return NextResponse.json({ message: 'Failed to get canned response' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

export const PUT = withApiAuth<RouteContext>(
  async (request: NextRequest, ctx, { params }) => {
    try {
      const { id } = await params;
      const body = await request.json();

      const existing = await getCannedResponse(id);
      if (!existing) {
        return NextResponse.json({ message: 'Canned response not found' }, { status: 404 });
      }

      await updateCannedResponse(id, body);

      await addLog({
        user: ctx.userId || 'Admin',
        action: 'Canned Response Updated',
        details: `Updated quick reply "/${body.shortcut || existing.shortcut}"`,
        type: 'info',
      });

      const updated = await getCannedResponse(id);
      return NextResponse.json(updated);
    } catch (error: any) {
      console.error('Failed to update canned response:', error);
      return NextResponse.json(
        { message: error.message || 'Failed to update canned response' },
        { status: 500 }
      );
    }
  },
  { roles: ['admin', 'operator'] }
);

export const DELETE = withApiAuth<RouteContext>(
  async (_request: NextRequest, ctx, { params }) => {
    try {
      const { id } = await params;
      const existing = await getCannedResponse(id);
      if (!existing) {
        return NextResponse.json({ message: 'Canned response not found' }, { status: 404 });
      }

      await deleteCannedResponse(id);

      await addLog({
        user: ctx.userId || 'Admin',
        action: 'Canned Response Deleted',
        details: `Deleted quick reply "/${existing.shortcut}" (${existing.title})`,
        type: 'warning',
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('Failed to delete canned response:', error);
      return NextResponse.json({ message: 'Failed to delete canned response' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);
