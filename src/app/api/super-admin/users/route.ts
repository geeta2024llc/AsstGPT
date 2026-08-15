import { NextRequest, NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Supabase Auth's admin API has no server-side email search, only
 * pagination. When searching, page through (bounded) and filter in memory
 * so results aren't silently limited to whatever page 1 happens to contain.
 */
async function findAllUsersMatching(
  admin: ReturnType<typeof getSupabaseAdmin>,
  search: string
): Promise<any[]> {
  const matches: any[] = [];
  const MAX_PAGES = 20; // safety cap: 20 * 1000 = 20k users scanned

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data.users.length) break;

    for (const u of data.users) {
      if (u.email?.toLowerCase().includes(search)) matches.push(u);
    }

    if (data.users.length < 1000) break; // last page exhausted
  }

  return matches;
}

export const GET = withPlatformAdminAuth(async (req: NextRequest) => {
  const admin = getSupabaseAdmin();
  const search = req.nextUrl.searchParams.get('q')?.trim().toLowerCase();
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1);

  let users: any[];
  if (search) {
    users = await findAllUsersMatching(admin, search);
  } else {
    const { data: authList, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) {
      return NextResponse.json({ error: 'Failed to list users' }, { status: 500 });
    }
    users = authList.users;
  }

  const userIds = users.map((u) => u.id);
  const { data: memberships } = await admin
    .from('tenant_members')
    .select('user_id, role, tenant_id, tenants(name, slug)')
    .in('user_id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);

  const membershipsByUser = new Map<string, any[]>();
  for (const m of memberships || []) {
    const list = membershipsByUser.get(m.user_id) || [];
    list.push({ tenantId: m.tenant_id, role: m.role, tenantName: (m as any).tenants?.name, tenantSlug: (m as any).tenants?.slug });
    membershipsByUser.set(m.user_id, list);
  }

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at,
      bannedUntil: (u as any).banned_until || null,
      isBanned: !!(u as any).banned_until && new Date((u as any).banned_until) > new Date(),
      memberships: membershipsByUser.get(u.id) || [],
    })),
    page,
  });
}, { roles: ['super_admin', 'auditor'] });
