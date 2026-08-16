import { NextRequest, NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { logPlatformAction } from '@/lib/platform-audit';
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
    if (error || !data?.users?.length) break;

    for (const u of data.users) {
      if (
        u.email?.toLowerCase().includes(search) ||
        (u.user_metadata?.full_name && String(u.user_metadata.full_name).toLowerCase().includes(search))
      ) {
        matches.push(u);
      }
    }

    if (data.users.length < 1000) break; // last page exhausted
  }

  return matches;
}

export const GET = withPlatformAdminAuth(async (req: NextRequest) => {
  const admin = getSupabaseAdmin();
  const search = req.nextUrl.searchParams.get('q')?.trim().toLowerCase();
  const roleFilter = req.nextUrl.searchParams.get('role')?.trim().toLowerCase();
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1);

  let users: any[];
  if (search) {
    users = await findAllUsersMatching(admin, search);
  } else {
    const { data: authList, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) {
      return NextResponse.json({ error: 'Failed to list users' }, { status: 500 });
    }
    users = authList.users || [];
  }

  const userIds = users.map((u) => u.id);
  const { data: memberships } = await admin
    .from('tenant_members')
    .select('user_id, role, tenant_id, tenants(name, slug)')
    .in('user_id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);

  const membershipsByUser = new Map<string, any[]>();
  for (const m of memberships || []) {
    const list = membershipsByUser.get(m.user_id) || [];
    list.push({
      tenantId: m.tenant_id,
      role: m.role,
      tenantName: (m as any).tenants?.name,
      tenantSlug: (m as any).tenants?.slug,
    });
    membershipsByUser.set(m.user_id, list);
  }

  // Platform-level admin status (public.platform_admins) is a separate
  // authorization boundary from tenant RBAC -- match by user_id where
  // linked, and by email otherwise, since super admins are provisioned
  // without any tenant_members row. Two bound .in() calls instead of one
  // interpolated .or() filter, since emails are user-controlled and a
  // comma/parenthesis in one could inject extra PostgREST filter syntax.
  const userEmails = users.map((u) => u.email?.toLowerCase()).filter(Boolean) as string[];
  const [byUserId, byEmail] = await Promise.all([
    userIds.length
      ? admin.from('platform_admins').select('user_id, email, platform_role').is('revoked_at', null).in('user_id', userIds)
      : Promise.resolve({ data: [] as any[] }),
    userEmails.length
      ? admin.from('platform_admins').select('user_id, email, platform_role').is('revoked_at', null).in('email', userEmails)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const platformRoleByUserId = new Map<string, string>();
  const platformRoleByEmail = new Map<string, string>();
  for (const p of [...(byUserId.data || []), ...(byEmail.data || [])]) {
    if (p.user_id) platformRoleByUserId.set(p.user_id, p.platform_role);
    if (p.email) platformRoleByEmail.set(p.email.toLowerCase(), p.platform_role);
  }

  let mappedUsers = users.map((u) => {
    const userMemberships = membershipsByUser.get(u.id) || [];
    const platformRole =
      platformRoleByUserId.get(u.id) || platformRoleByEmail.get(u.email?.toLowerCase() || '');
    const primaryRole =
      platformRole ||
      userMemberships[0]?.role ||
      u.app_metadata?.role ||
      u.user_metadata?.role ||
      'member';

    const expiresAt = u.app_metadata?.expires_at || u.user_metadata?.expires_at || null;
    const isExpired = expiresAt ? new Date(expiresAt) <= new Date() : false;
    const hasActiveBan = !!(u as any).banned_until && new Date((u as any).banned_until) > new Date();

    return {
      id: u.id,
      email: u.email,
      fullName: u.user_metadata?.full_name || '',
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at,
      bannedUntil: (u as any).banned_until || null,
      expiresAt,
      isExpired,
      isBanned: hasActiveBan || isExpired,
      primaryRole,
      memberships: userMemberships,
    };
  });

  if (roleFilter && roleFilter !== 'all') {
    mappedUsers = mappedUsers.filter((u) =>
      u.primaryRole === roleFilter || u.memberships.some((m) => m.role === roleFilter)
    );
  }

  return NextResponse.json({
    users: mappedUsers,
    total: mappedUsers.length,
    page,
  });
}, { roles: ['super_admin', 'auditor'] });

export const POST = withPlatformAdminAuth(async (req: NextRequest, ctx) => {
  const admin = getSupabaseAdmin();
  const body = await req.json().catch(() => ({}));

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password;
  const fullName = (body.fullName || '').trim();
  const tenantId = (body.tenantId || '').trim();
  const role = (body.role || 'admin').trim().toLowerCase();

  if (!email || !password || !tenantId) {
    return NextResponse.json(
      { error: 'Email, password, and target organization (tenantId) are required' },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters long' },
      { status: 400 }
    );
  }

  const validRoles = ['owner', 'admin', 'operator', 'viewer'];
  if (!validRoles.includes(role)) {
    return NextResponse.json(
      { error: `Invalid role. Must be one of: ${validRoles.join(', ')}` },
      { status: 400 }
    );
  }

  // 1. Verify tenant existence
  const { data: tenant, error: tenantErr } = await admin
    .from('tenants')
    .select('id, name, slug')
    .eq('id', tenantId)
    .maybeSingle();

  if (tenantErr || !tenant) {
    return NextResponse.json({ error: 'Selected organization does not exist' }, { status: 404 });
  }

  // 2. Create the Auth user with tenant_id and role stamped into app_metadata
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { tenant_id: tenantId, role },
  });

  if (createErr || !created?.user) {
    const isConflict = createErr?.message?.toLowerCase().includes('already registered');
    return NextResponse.json(
      { error: isConflict ? 'An account with this email already exists' : createErr?.message || 'Failed to create user' },
      { status: isConflict ? 409 : 400 }
    );
  }

  const userId = created.user.id;

  // 3. Upsert into public.users table
  await admin.from('users').upsert({
    id: userId,
    email,
    full_name: fullName,
  }, { onConflict: 'id' });

  // 4. Create membership in tenant_members
  const { error: memberErr } = await admin.from('tenant_members').insert({
    tenant_id: tenantId,
    user_id: userId,
    role,
  });

  if (memberErr) {
    console.error('Failed to link tenant membership:', memberErr);
    // Cleanup created auth user if membership fails
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return NextResponse.json({ error: 'Failed to assign workspace membership' }, { status: 500 });
  }

  // 5. Create immutable platform audit log entry
  await logPlatformAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: 'user.create',
    targetType: 'user',
    targetId: userId,
    tenantId,
    ip: ctx.ip,
    metadata: {
      email,
      fullName,
      role,
      tenantId,
      tenantName: tenant.name,
    },
  });

  return NextResponse.json({
    id: userId,
    email,
    fullName,
    role,
    tenantId,
    tenantName: tenant.name,
    isBanned: false,
    createdAt: created.user.created_at,
  }, { status: 201 });
}, { roles: ['super_admin'] });
