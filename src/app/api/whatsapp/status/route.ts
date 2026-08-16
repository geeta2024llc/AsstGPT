import { NextRequest, NextResponse } from 'next/server';
import { getTenantClientState } from '@/lib/whatsapp-client';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(
  async (_req: NextRequest, ctx) => {
    const tenantId = ctx.tenantId || process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
    const tenantState = await getTenantClientState(tenantId);
    return NextResponse.json(tenantState);
  },
  { allowPublic: true, roles: ['admin', 'operator'] }
);
