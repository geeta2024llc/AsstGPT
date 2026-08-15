import { NextRequest, NextResponse } from 'next/server';
import { supabase, getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 48);
  return base || 'workspace';
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 7);
}

/**
 * Provisions a brand-new tenant (workspace) for a self-serve signup:
 * creates the tenant, the Supabase Auth user with tenant_id/role stamped
 * into app_metadata (the only claims middleware.ts trusts for tenant
 * resolution), and an owning tenant_members row.
 */
export async function POST(req: NextRequest) {
  let body: { fullName?: string; companyName?: string; email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const fullName = body.fullName?.trim();
  const companyName = body.companyName?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!fullName || !companyName || !email || !password) {
    return NextResponse.json(
      { error: 'fullName, companyName, email, and password are all required' },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    console.error('Signup provisioning misconfigured:', err);
    return NextResponse.json({ error: 'Signup is not available right now' }, { status: 503 });
  }

  // 1. Create the tenant first (no FK dependency on the user yet), retrying on slug collision.
  const baseSlug = slugify(companyName);
  let tenant: { id: string; name: string; slug: string } | null = null;
  let slug = baseSlug;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await admin
      .from('tenants')
      .insert({ name: companyName, slug })
      .select('id, name, slug')
      .single();

    if (!error && data) {
      tenant = data;
      break;
    }
    if (error?.code === '23505') {
      slug = `${baseSlug}-${randomSuffix()}`;
      continue;
    }
    console.error('Tenant creation failed:', error);
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 });
  }
  if (!tenant) {
    return NextResponse.json({ error: 'Failed to allocate a workspace slug' }, { status: 500 });
  }

  // 2. Create the Auth user with tenant_id/role stamped directly into app_metadata.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, company_name: companyName },
    app_metadata: { tenant_id: tenant.id, role: 'admin' },
  });

  if (createErr || !created?.user) {
    // Orphaned tenant with no members yet — safe to remove so the slug can be reused.
    await admin.from('tenants').delete().eq('id', tenant.id);
    const message = createErr?.message?.includes('already registered')
      ? 'An account with this email already exists'
      : createErr?.message || 'Failed to create account';
    const status = createErr?.message?.includes('already registered') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  const userId = created.user.id;

  // 3. Link the new user to their tenant as owner.
  const { error: memberErr } = await admin
    .from('tenant_members')
    .insert({ tenant_id: tenant.id, user_id: userId, role: 'owner' });

  if (memberErr) {
    console.error('tenant_members insert failed, rolling back:', memberErr);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    try {
      await admin.from('tenants').delete().eq('id', tenant.id);
    } catch {
      // best-effort cleanup
    }
    return NextResponse.json({ error: 'Failed to finish workspace setup' }, { status: 500 });
  }

  // 4. Sign the new user in to hand the client a real session (admin.createUser mints no session).
  const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr || !signInData?.session) {
    console.error('Post-signup sign-in failed:', signInErr);
    return NextResponse.json(
      { error: 'Account created. Please sign in.', requiresLogin: true },
      { status: 200 }
    );
  }

  return NextResponse.json({
    session: {
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
      expires_at: signInData.session.expires_at,
    },
    tenant,
  });
}
