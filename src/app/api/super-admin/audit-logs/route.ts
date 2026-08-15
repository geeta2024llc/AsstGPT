import { NextRequest, NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withPlatformAdminAuth(async (req: NextRequest) => {
  const admin = getSupabaseAdmin();
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1);
  const pageSize = 50;
  const actorEmail = req.nextUrl.searchParams.get('actor')?.trim();
  const action = req.nextUrl.searchParams.get('action')?.trim();

  let query = admin
    .from('platform_audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (actorEmail) query = query.ilike('actor_email', `%${actorEmail}%`);
  if (action) query = query.ilike('action', `%${action}%`);

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: 'Failed to load audit logs' }, { status: 500 });
  }

  return NextResponse.json({ rows: data || [], total: count || 0, page, pageSize });
}, { roles: ['super_admin', 'auditor'] });
