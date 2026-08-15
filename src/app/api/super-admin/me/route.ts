import { NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';

export const dynamic = 'force-dynamic';

export const GET = withPlatformAdminAuth(
  async (_req, ctx) => {
    return NextResponse.json({ email: ctx.email, platformRole: ctx.platformRole });
  },
  { roles: ['super_admin', 'auditor'] }
);
