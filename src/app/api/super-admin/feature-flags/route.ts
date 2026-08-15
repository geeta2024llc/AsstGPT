import { NextRequest, NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { logPlatformAction } from '@/lib/platform-audit';
import { clearFeatureFlagCache } from '@/lib/feature-flags';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withPlatformAdminAuth(async () => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('feature_flags').select('*').order('key', { ascending: true });
  if (error) {
    return NextResponse.json({ error: 'Failed to load feature flags' }, { status: 500 });
  }
  return NextResponse.json(data || []);
}, { roles: ['super_admin', 'auditor'] });

export const POST = withPlatformAdminAuth(async (req: NextRequest, ctx) => {
  const admin = getSupabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const key = (body.key || '').trim();

  if (!key) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 });
  }

  const { data, error } = await admin
    .from('feature_flags')
    .insert({ key, enabled: !!body.enabled, description: body.description || null })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  clearFeatureFlagCache();
  await logPlatformAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: 'feature_flag.create',
    targetType: 'feature_flag',
    targetId: key,
    ip: ctx.ip,
    metadata: { enabled: data.enabled },
  });

  return NextResponse.json(data, { status: 201 });
});

export const PATCH = withPlatformAdminAuth(async (req: NextRequest, ctx) => {
  const admin = getSupabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const key = (body.key || '').trim();

  if (!key || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'key and enabled are required' }, { status: 400 });
  }

  const { data, error } = await admin
    .from('feature_flags')
    .update({ enabled: body.enabled, updated_at: new Date().toISOString() })
    .eq('key', key)
    .select('*')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'Flag not found' }, { status: 404 });
  }

  clearFeatureFlagCache();
  await logPlatformAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: 'feature_flag.toggle',
    targetType: 'feature_flag',
    targetId: key,
    ip: ctx.ip,
    metadata: { enabled: body.enabled },
  });

  return NextResponse.json(data);
});
