import { NextRequest, NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withPlatformAdminAuth(async (_req: NextRequest) => {
  const admin = getSupabaseAdmin();

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    tenantsTotal,
    tenantsActive,
    signupsToday,
    signupsWeek,
    signupsMonth,
    channelsConnected,
    channelsTotal,
    messagesTotal,
    aiUsageTotal,
    aiUsageFailures,
  ] = await Promise.all([
    admin.from('tenants').select('id', { count: 'exact', head: true }),
    admin.from('tenants').select('id', { count: 'exact', head: true }).eq('is_active', true),
    admin.from('tenants').select('id', { count: 'exact', head: true }).gte('created_at', dayAgo),
    admin.from('tenants').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    admin.from('tenants').select('id', { count: 'exact', head: true }).gte('created_at', monthAgo),
    admin.from('channels').select('id', { count: 'exact', head: true }).eq('type', 'whatsapp').eq('status', 'connected'),
    admin.from('channels').select('id', { count: 'exact', head: true }).eq('type', 'whatsapp'),
    admin.from('messages').select('id', { count: 'exact', head: true }),
    admin.from('ai_usage_logs').select('id', { count: 'exact', head: true }).gte('created_at', monthAgo),
    admin.from('ai_usage_logs').select('id', { count: 'exact', head: true }).gte('created_at', monthAgo).eq('success', false),
  ]);

  const aiTotal = aiUsageTotal.count || 0;
  const aiFailures = aiUsageFailures.count || 0;
  const aiFailureRate = aiTotal > 0 ? Number(((aiFailures / aiTotal) * 100).toFixed(2)) : 0;

  const { data: recentAudit } = await admin
    .from('platform_audit_logs')
    .select('id, actor_email, action, target_type, target_id, tenant_id, result, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  return NextResponse.json({
    tenants: { total: tenantsTotal.count || 0, active: tenantsActive.count || 0 },
    signups: { today: signupsToday.count || 0, week: signupsWeek.count || 0, month: signupsMonth.count || 0 },
    whatsapp: { connected: channelsConnected.count || 0, total: channelsTotal.count || 0 },
    messages: { total: messagesTotal.count || 0 },
    ai: { requests30d: aiTotal, failures30d: aiFailures, failureRatePct: aiFailureRate },
    recentAuditLogs: recentAudit || [],
  });
}, { roles: ['super_admin', 'auditor'] });
