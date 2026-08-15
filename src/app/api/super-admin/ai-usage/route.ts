import { NextRequest, NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withPlatformAdminAuth(async (req: NextRequest) => {
  const admin = getSupabaseAdmin();
  const rangeDays = Number(req.nextUrl.searchParams.get('days')) || 30;
  const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from('ai_usage_logs')
    .select('tenant_id, provider, model, input_tokens, output_tokens, estimated_cost_usd, latency_ms, success, tenants(name, slug)')
    .gte('created_at', since)
    .limit(20000);

  if (error) {
    return NextResponse.json({ error: 'Failed to load AI usage' }, { status: 500 });
  }

  type Agg = {
    tenantId: string | null;
    tenantName?: string;
    provider: string;
    requests: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    latencySumMs: number;
  };

  const byTenantProvider = new Map<string, Agg>();
  for (const row of data || []) {
    const key = `${row.tenant_id}:${row.provider}`;
    const entry = byTenantProvider.get(key) || {
      tenantId: row.tenant_id,
      tenantName: (row as any).tenants?.name,
      provider: row.provider,
      requests: 0,
      failures: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      latencySumMs: 0,
    };
    entry.requests += 1;
    if (!row.success) entry.failures += 1;
    entry.inputTokens += row.input_tokens || 0;
    entry.outputTokens += row.output_tokens || 0;
    entry.estimatedCostUsd += row.estimated_cost_usd || 0;
    entry.latencySumMs += row.latency_ms || 0;
    byTenantProvider.set(key, entry);
  }

  const rows = Array.from(byTenantProvider.values()).map((r) => ({
    tenantId: r.tenantId,
    tenantName: r.tenantName,
    provider: r.provider,
    requests: r.requests,
    failures: r.failures,
    failureRatePct: r.requests > 0 ? Number(((r.failures / r.requests) * 100).toFixed(2)) : 0,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    estimatedCostUsd: Number(r.estimatedCostUsd.toFixed(4)),
    avgLatencyMs: r.requests > 0 ? Math.round(r.latencySumMs / r.requests) : 0,
  }));

  rows.sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

  return NextResponse.json({ rangeDays, rows });
}, { roles: ['super_admin', 'auditor'] });
