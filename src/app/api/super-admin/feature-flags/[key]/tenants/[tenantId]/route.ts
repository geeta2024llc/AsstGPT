import { NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { logPlatformAction } from '@/lib/platform-audit';
import { clearFeatureFlagCache } from '@/lib/feature-flags';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ key: string; tenantId: string }> };

export const PATCH = withPlatformAdminAuth<RouteContext>(async (req, ctx, routeContext) => {
  const { key, tenantId } = await routeContext.params;
  const body = await req.json().catch(() => ({}));
  const admin = getSupabaseAdmin();

  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) is required' }, { status: 400 });
  }

  const { data, error } = await admin
    .from('tenant_feature_flags')
    .upsert({ tenant_id: tenantId, flag_key: key, enabled: body.enabled, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,flag_key' })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  clearFeatureFlagCache();
  await logPlatformAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: 'feature_flag.tenant_override',
    targetType: 'feature_flag',
    targetId: key,
    tenantId,
    ip: ctx.ip,
    metadata: { enabled: body.enabled },
  });

  return NextResponse.json(data);
});

export const DELETE = withPlatformAdminAuth<RouteContext>(async (_req, ctx, routeContext) => {
  const { key, tenantId } = await routeContext.params;
  const admin = getSupabaseAdmin();

  await admin.from('tenant_feature_flags').delete().eq('tenant_id', tenantId).eq('flag_key', key);
  clearFeatureFlagCache();

  await logPlatformAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: 'feature_flag.tenant_override_clear',
    targetType: 'feature_flag',
    targetId: key,
    tenantId,
    ip: ctx.ip,
  });

  return NextResponse.json({ ok: true });
});
