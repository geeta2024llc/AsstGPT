import { NextRequest, NextResponse } from 'next/server';
import { getAllContactProfiles, deleteContactProfiles, addLog } from '@/lib/db';
import { withApiAuth } from '@/lib/api-guard';
import type { LeadStage } from '@/types';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async (request: NextRequest) => {
    try {
      const url = new URL(request.url);
      const stageParam = url.searchParams.get('stage') as LeadStage | 'all' | null;
      const searchParam = url.searchParams.get('search') || undefined;

      const result = await getAllContactProfiles({
        stage: stageParam || 'all',
        search: searchParam,
      });

      return NextResponse.json(result);
    } catch (error: any) {
      console.error('Failed to fetch CRM contacts list:', error);
      return NextResponse.json(
        { message: error.message || 'Failed to fetch contacts' },
        { status: 500 }
      );
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

export const DELETE = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json().catch(() => ({}));
      const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
      const externalIds: string[] = Array.isArray(body.externalIds) ? body.externalIds : [];

      if (ids.length === 0 && externalIds.length === 0) {
        return NextResponse.json(
          { message: 'Please provide contact ids or externalIds to delete.' },
          { status: 400 }
        );
      }

      const result = await deleteContactProfiles({ ids, externalIds });

      await addLog({
        user: ctx.userId || 'Admin',
        action: 'Contacts Bulk Deleted',
        details: `Deleted ${result.count} client contact(s) from CRM.`,
        type: 'warning',
      });

      return NextResponse.json({
        success: true,
        count: result.count,
        message: `Successfully deleted ${result.count} contact(s).`,
      });
    } catch (error: any) {
      console.error('Failed to bulk delete contacts:', error);
      return NextResponse.json(
        { message: error.message || 'Failed to delete contacts' },
        { status: 500 }
      );
    }
  },
  { roles: ['admin', 'operator'] }
);
