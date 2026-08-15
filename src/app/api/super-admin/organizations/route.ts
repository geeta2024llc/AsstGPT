import { NextRequest, NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { logPlatformAction } from '@/lib/platform-audit';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withPlatformAdminAuth(async (req: NextRequest) => {
  const admin = getSupabaseAdmin();
  const search = req.nextUrl.searchParams.get('q')?.trim();

  const baseSelect = 'id, name, slug, plan, is_active, suspended_at, suspended_reason, created_at';
  let data: any[] | null;
  let error: any;

  if (search) {
    // Two separate .ilike() calls (each parameter-bound by supabase-js) instead
    // of interpolating the term into a raw .or() filter string, which would let
    // a comma/parenthesis in the search term inject extra PostgREST filter syntax.
    const [byName, bySlug] = await Promise.all([
      admin.from('tenants').select(baseSelect).ilike('name', `%${search}%`).order('created_at', { ascending: false }).limit(200),
      admin.from('tenants').select(baseSelect).ilike('slug', `%${search}%`).order('created_at', { ascending: false }).limit(200),
    ]);
    error = byName.error || bySlug.error;
    const merged = new Map<string, any>();
    for (const row of [...(byName.data || []), ...(bySlug.data || [])]) merged.set(row.id, row);
    data = Array.from(merged.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 200);
  } else {
    const res = await admin.from('tenants').select(baseSelect).order('created_at', { ascending: false }).limit(200);
    data = res.data;
    error = res.error;
  }

  if (error) {
    return NextResponse.json({ error: 'Failed to list organizations' }, { status: 500 });
  }

  const tenantIds = (data || []).map((t) => t.id);
  const [{ data: memberCounts }, { data: channelRows }] = await Promise.all([
    admin.from('tenant_members').select('tenant_id').in('tenant_id', tenantIds),
    admin.from('channels').select('tenant_id, status').eq('type', 'whatsapp').in('tenant_id', tenantIds),
  ]);

  const memberCountByTenant = new Map<string, number>();
  for (const row of memberCounts || []) {
    memberCountByTenant.set(row.tenant_id, (memberCountByTenant.get(row.tenant_id) || 0) + 1);
  }
  const whatsappStatusByTenant = new Map<string, string>();
  for (const row of channelRows || []) {
    whatsappStatusByTenant.set(row.tenant_id, row.status);
  }

  const organizations = (data || []).map((t) => ({
    ...t,
    memberCount: memberCountByTenant.get(t.id) || 0,
    whatsappStatus: whatsappStatusByTenant.get(t.id) || 'none',
  }));

  return NextResponse.json(organizations);
}, { roles: ['super_admin', 'auditor'] });

export const POST = withPlatformAdminAuth(async (req: NextRequest, ctx) => {
  const admin = getSupabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const name = (body.name || '').trim();
  const slug = (body.slug || '').trim().toLowerCase();

  if (!name || !slug) {
    return NextResponse.json({ error: 'name and slug are required' }, { status: 400 });
  }

  const { data, error } = await admin
    .from('tenants')
    .insert({ name, slug })
    .select('id, name, slug, plan, is_active, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  await logPlatformAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: 'organization.create',
    targetType: 'tenant',
    targetId: data.id,
    tenantId: data.id,
    ip: ctx.ip,
    metadata: { name, slug },
  });

  return NextResponse.json(data, { status: 201 });
});
