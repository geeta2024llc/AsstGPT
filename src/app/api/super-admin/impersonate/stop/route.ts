import { NextRequest, NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { logPlatformAction } from '@/lib/platform-audit';

export const dynamic = 'force-dynamic';

/**
 * Called by the client immediately after it restores the super admin's own
 * session (via the tokens stashed in sessionStorage before impersonation
 * started), so this request is authenticated as the super admin again --
 * not as the user who was being impersonated.
 */
export const POST = withPlatformAdminAuth(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => ({}));

  await logPlatformAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: 'impersonate_stop',
    targetType: 'user',
    targetId: body.targetUserId,
    tenantId: body.tenantId,
    ip: ctx.ip,
  });

  return NextResponse.json({ ok: true });
});
