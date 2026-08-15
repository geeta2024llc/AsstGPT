import { NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { logPlatformAction } from '@/lib/platform-audit';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

// Uses Supabase Auth's native ban mechanism instead of a bespoke is_active
// column: ban_duration set far in the future disables sign-in, 'none' clears it.
export const PATCH = withPlatformAdminAuth<RouteContext>(async (req, ctx, routeContext) => {
  const { id } = await routeContext.params;
  const body = await req.json().catch(() => ({}));
  const admin = getSupabaseAdmin();

  if (body.action !== 'ban' && body.action !== 'unban') {
    return NextResponse.json({ error: 'action must be "ban" or "unban"' }, { status: 400 });
  }

  const banDuration = body.action === 'ban' ? '876000h' : 'none'; // ~100 years == indefinite

  const { data, error } = await admin.auth.admin.updateUserById(id, { ban_duration: banDuration });
  if (error || !data?.user) {
    return NextResponse.json({ error: error?.message || 'User not found' }, { status: 404 });
  }

  await logPlatformAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: body.action === 'ban' ? 'user.ban' : 'user.unban',
    targetType: 'user',
    targetId: id,
    ip: ctx.ip,
    metadata: { targetEmail: data.user.email, reason: body.reason },
  });

  return NextResponse.json({
    id: data.user.id,
    email: data.user.email,
    bannedUntil: (data.user as any).banned_until || null,
  });
});
