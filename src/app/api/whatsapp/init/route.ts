import { NextRequest, NextResponse } from 'next/server';
import { initTenant } from '@/lib/whatsapp-client';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export const POST = withApiAuth(
  async (_req: NextRequest, ctx) => {
    const tenantId = ctx.tenantId || process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
    try {
      await initTenant(tenantId);
      return NextResponse.json({ success: true, message: 'WhatsApp client initialization started.' });
    } catch (error) {
      console.error(`Failed to init whatsapp client for workspace ${tenantId}`, error);
      return NextResponse.json({ success: false, message: 'Failed to initialize WhatsApp client.' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);
