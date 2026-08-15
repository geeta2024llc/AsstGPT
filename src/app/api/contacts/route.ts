import { NextRequest, NextResponse } from 'next/server';
import { getAllContactProfiles } from '@/lib/db';
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
