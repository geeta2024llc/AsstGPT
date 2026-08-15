import { NextRequest, NextResponse } from 'next/server';
import { getHandoffRule, updateHandoffRule, deleteHandoffRule, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApiAuth<RouteContext>(
  async (_request: NextRequest, _ctx, { params }) => {
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
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

export const PUT = withApiAuth<RouteContext>(
  async (request: NextRequest, ctx, { params }) => {
    try {
      const { id } = await params;
      const body = await request.json();

      const existing = await getHandoffRule(id);
      if (!existing) {
        return NextResponse.json({ message: 'Handoff rule not found' }, { status: 404 });
      }

      await updateHandoffRule(id, body);

      await addLog({
        user: ctx.userId || 'Admin',
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
  },
  { roles: ['admin', 'operator'] }
);

export const DELETE = withApiAuth<RouteContext>(
  async (_request: NextRequest, ctx, { params }) => {
    try {
      const { id } = await params;
      const existing = await getHandoffRule(id);
      if (!existing) {
        return NextResponse.json({ message: 'Handoff rule not found' }, { status: 404 });
      }

      await deleteHandoffRule(id);

      await addLog({
        user: ctx.userId || 'Admin',
        action: 'Handoff Rule Deleted',
        details: `Deleted handoff rule "${existing.name}"`,
        type: 'warning',
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('Failed to delete handoff rule:', error);
      return NextResponse.json({ message: 'Failed to delete handoff rule' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);
