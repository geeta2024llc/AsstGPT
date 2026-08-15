import { NextRequest, NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { logPlatformAction } from '@/lib/platform-audit';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withPlatformAdminAuth<RouteContext>(async (_req, _ctx, routeContext) => {
  const { id } = await routeContext.params;
  const admin = getSupabaseAdmin();

  const { data: tenant, error } = await admin
    .from('tenants')
    .select('id, name, slug, plan, is_active, suspended_at, suspended_reason, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();

  if (error || !tenant) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  const [{ count: memberCount }, { count: agentCount }, { count: messageCount }, channels, aiUsage, members] = await Promise.all([
    admin.from('tenant_members').select('id', { count: 'exact', head: true }).eq('tenant_id', id),
    admin.from('agents').select('id', { count: 'exact', head: true }).eq('tenant_id', id),
    admin.from('messages').select('id', { count: 'exact', head: true }).eq('tenant_id', id),
    admin.from('channels').select('id, type, status, display_name, updated_at').eq('tenant_id', id),
    admin.from('ai_usage_logs').select('provider, estimated_cost_usd, success').eq('tenant_id', id).limit(5000),
    admin.from('tenant_members').select('user_id, role, created_at, users(email, full_name)').eq('tenant_id', id),
  ]);

  const aiRows = aiUsage.data || [];
  const aiTotalCost = aiRows.reduce((sum, r) => sum + (r.estimated_cost_usd || 0), 0);
  const aiFailures = aiRows.filter((r) => !r.success).length;

  return NextResponse.json({
    ...tenant,
    memberCount: memberCount || 0,
    agentCount: agentCount || 0,
    messageCount: messageCount || 0,
    channels: channels.data || [],
    aiUsage: { totalRequests: aiRows.length, totalEstimatedCostUsd: Number(aiTotalCost.toFixed(4)), failures: aiFailures },
    members: (members.data || []).map((m: any) => ({
      userId: m.user_id,
      role: m.role,
      email: m.users?.email,
      fullName: m.users?.full_name,
      joinedAt: m.created_at,
    })),
  });
}, { roles: ['super_admin', 'auditor'] });

export const PATCH = withPlatformAdminAuth<RouteContext>(async (req, ctx, routeContext) => {
  const { id } = await routeContext.params;
  const admin = getSupabaseAdmin();
  const body = await req.json().catch(() => ({}));

  const updates: Record<string, any> = {};
  let action = 'organization.update';

  if (body.action === 'suspend') {
    updates.is_active = false;
    updates.suspended_at = new Date().toISOString();
    updates.suspended_reason = body.reason || null;
    action = 'organization.suspend';
  } else if (body.action === 'reactivate') {
    updates.is_active = true;
    updates.suspended_at = null;
    updates.suspended_reason = null;
    action = 'organization.reactivate';
  } else {
    if (typeof body.plan === 'string') updates.plan = body.plan;
    if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await admin.from('tenants').update(updates).eq('id', id).select('*').single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'Organization not found' }, { status: 404 });
  }

  await logPlatformAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action,
    targetType: 'tenant',
    targetId: id,
    tenantId: id,
    ip: ctx.ip,
    metadata: { updates, reason: body.reason },
  });

  return NextResponse.json(data);
});

// Hard-deletes a tenant and everything scoped to it (every tenant-owned
// table FKs to tenants(id) ON DELETE CASCADE, so this single delete removes
// members, conversations, messages, agents, channels, invitations, etc.
// in one statement). Requires the caller to type the tenant's exact slug to
// confirm -- irreversible, so this is deliberately not a one-click action.
export const DELETE = withPlatformAdminAuth<RouteContext>(async (req, ctx, routeContext) => {
  const { id } = await routeContext.params;
  const admin = getSupabaseAdmin();

  const { data: tenant, error: fetchErr } = await admin
    .from('tenants')
    .select('id, name, slug')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !tenant) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const confirmation = typeof body.confirm === 'string' ? body.confirm.trim() : '';
  if (confirmation !== tenant.slug) {
    return NextResponse.json(
      { error: `Type the workspace slug ("${tenant.slug}") to confirm deletion.` },
      { status: 400 }
    );
  }

  // Logged BEFORE the delete: platform_audit_logs.tenant_id FKs to
  // tenants(id), so the tenant must still exist for this insert to succeed.
  // The FK's ON DELETE SET NULL will null tenant_id out automatically once
  // the tenant row is gone below -- name/slug in metadata keep the record
  // meaningful regardless.
  await logPlatformAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: 'organization.delete',
    targetType: 'tenant',
    targetId: id,
    tenantId: id,
    ip: ctx.ip,
    metadata: { name: tenant.name, slug: tenant.slug },
  });

  // Clean up WhatsApp session locks and connection state associated with this tenant's channels
  try {
    const { data: channels } = await admin
      .from('channels')
      .select('id')
      .eq('tenant_id', id);

    if (channels && channels.length > 0) {
      const channelIds = channels.map((c) => c.id);
      await admin.from('whatsapp_session_lock').delete().in('channel_id', channelIds);
      await admin.from('whatsapp_connection_state').delete().in('channel_id', channelIds);
    }
  } catch (cleanErr) {
    console.warn(`[WARN] WhatsApp session cleanup for deleted tenant ${id} error:`, cleanErr);
  }

  const { error: deleteErr } = await admin.from('tenants').delete().eq('id', id);
  if (deleteErr) {
    await logPlatformAction({
      actorUserId: ctx.userId,
      actorEmail: ctx.email,
      action: 'organization.delete',
      targetType: 'tenant',
      targetId: id,
      ip: ctx.ip,
      metadata: { name: tenant.name, slug: tenant.slug, error: deleteErr.message },
      result: 'failure',
    });
    return NextResponse.json({ error: deleteErr.message || 'Failed to delete organization' }, { status: 500 });
  }

  return NextResponse.json({ success: true, id });
}, { roles: ['super_admin'] });
