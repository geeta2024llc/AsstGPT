import { NextRequest, NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { logPlatformAction } from '@/lib/platform-audit';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Starts a full session impersonation using Supabase's legitimate magic-link
 * mechanism -- the target user's password is never read or touched. The
 * client exchanges the returned hashedToken via supabase.auth.verifyOtp(...)
 * to establish a real session as that user.
 */
export const POST = withPlatformAdminAuth(async (req: NextRequest, ctx) => {
  const admin = getSupabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const targetUserId = (body.targetUserId || '').trim();

  if (!targetUserId) {
    return NextResponse.json({ error: 'targetUserId is required' }, { status: 400 });
  }

  const { data: targetUser, error: targetErr } = await admin.auth.admin.getUserById(targetUserId);
  if (targetErr || !targetUser?.user?.email) {
    return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
  }

  const { data: membership } = await admin
    .from('tenant_members')
    .select('tenant_id, tenants(name)')
    .eq('user_id', targetUserId)
    .limit(1)
    .maybeSingle();

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: targetUser.user.email,
  });

  if (linkErr || !linkData?.properties?.hashed_token) {
    await logPlatformAction({
      actorUserId: ctx.userId,
      actorEmail: ctx.email,
      action: 'impersonate_start',
      targetType: 'user',
      targetId: targetUserId,
      tenantId: membership?.tenant_id,
      ip: ctx.ip,
      result: 'failure',
      metadata: { targetEmail: targetUser.user.email, error: linkErr?.message },
    });
    return NextResponse.json({ error: 'Failed to generate impersonation session' }, { status: 500 });
  }

  await logPlatformAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: 'impersonate_start',
    targetType: 'user',
    targetId: targetUserId,
    tenantId: membership?.tenant_id,
    ip: ctx.ip,
    metadata: { targetEmail: targetUser.user.email, reason: body.reason },
  });

  return NextResponse.json({
    email: targetUser.user.email,
    hashedToken: linkData.properties.hashed_token,
    tenantId: membership?.tenant_id || null,
    tenantName: (membership as any)?.tenants?.name || null,
  });
});
