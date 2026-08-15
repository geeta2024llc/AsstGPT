import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/api-guard';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withApiAuth(async (_req, ctx) => {
  if (!ctx.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data: userRecord } = await admin
    .from('users')
    .select('id, email, full_name, avatar_url, role')
    .eq('id', ctx.userId)
    .maybeSingle();

  const { data: authUser } = await admin.auth.admin.getUserById(ctx.userId);

  const fullName = userRecord?.full_name || authUser?.user?.user_metadata?.full_name || '';
  const email = userRecord?.email || authUser?.user?.email || '';
  const avatarUrl = userRecord?.avatar_url || authUser?.user?.user_metadata?.avatar_url || '';
  const role = userRecord?.role || 'operator';

  return NextResponse.json({
    id: ctx.userId,
    email,
    fullName,
    avatarUrl,
    role,
  });
});

export const PATCH = withApiAuth(async (req: NextRequest, ctx) => {
  if (!ctx.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { fullName, avatarUrl, newPassword } = body;
    const admin = getSupabaseAdmin();

    const authUpdates: any = { user_metadata: {} };
    const dbUpdates: any = {};

    if (typeof fullName === 'string') {
      const trimmed = fullName.trim();
      if (!trimmed) {
        return NextResponse.json({ error: 'Full name cannot be empty' }, { status: 400 });
      }
      authUpdates.user_metadata.full_name = trimmed;
      dbUpdates.full_name = trimmed;
    }

    if (typeof avatarUrl === 'string') {
      const trimmed = avatarUrl.trim();
      authUpdates.user_metadata.avatar_url = trimmed || null;
      dbUpdates.avatar_url = trimmed || null;
    }

    if (typeof newPassword === 'string' && newPassword.length > 0) {
      if (newPassword.length < 6) {
        return NextResponse.json(
          { error: 'New password must be at least 6 characters long.' },
          { status: 400 }
        );
      }
      authUpdates.password = newPassword;
    }

    // Update Supabase Auth User
    const { data: updatedAuthUser, error: authErr } = await admin.auth.admin.updateUserById(
      ctx.userId,
      authUpdates
    );

    if (authErr) {
      throw new Error(authErr.message || 'Failed to update user profile in auth');
    }

    // Update users table
    if (Object.keys(dbUpdates).length > 0) {
      await admin.from('users').update(dbUpdates).eq('id', ctx.userId);
    }

    return NextResponse.json({
      success: true,
      user: {
        id: ctx.userId,
        fullName: updatedAuthUser?.user?.user_metadata?.full_name || fullName,
        avatarUrl: updatedAuthUser?.user?.user_metadata?.avatar_url || avatarUrl,
        email: updatedAuthUser?.user?.email,
      },
      message: 'Account updated successfully.',
    });
  } catch (error: any) {
    console.error('Failed to update account:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update account profile' },
      { status: 500 }
    );
  }
});

export const DELETE = withApiAuth(async (_req, ctx) => {
  if (!ctx.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  // A platform admin must have their platform access revoked by another
  // super admin before they can delete their own account, so the platform
  // is never left without a way to manage it.
  const { data: platformAdmin } = await admin
    .from('platform_admins')
    .select('id')
    .eq('user_id', ctx.userId)
    .is('revoked_at', null)
    .maybeSingle();

  if (platformAdmin) {
    return NextResponse.json(
      { error: 'Your account has platform administrator access. Ask another super admin to revoke it before deleting your account.' },
      { status: 409 }
    );
  }

  const { data: memberships } = await admin
    .from('tenant_members')
    .select('tenant_id, role, tenants(name)')
    .eq('user_id', ctx.userId);

  const blockedTenantNames: string[] = [];
  const soleOwnedTenantIds: string[] = [];

  for (const membership of memberships || []) {
    if (membership.role !== 'owner') continue;

    const { count } = await admin
      .from('tenant_members')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', membership.tenant_id);

    if ((count || 0) > 1) {
      const tenantName = (membership as any).tenants?.name || membership.tenant_id;
      blockedTenantNames.push(tenantName);
    } else {
      soleOwnedTenantIds.push(membership.tenant_id);
    }
  }

  if (blockedTenantNames.length > 0) {
    return NextResponse.json(
      {
        error: `You are the sole owner of "${blockedTenantNames.join('", "')}" which still has other members. Transfer ownership or remove all other members before deleting your account.`,
      },
      { status: 409 }
    );
  }

  // Tenants this user solely owned with no other members are deleted outright;
  // this cascades (via tenant_id ON DELETE CASCADE) to all workspace-scoped data.
  for (const tenantId of soleOwnedTenantIds) {
    await admin.from('tenants').delete().eq('id', tenantId);
  }

  await admin.from('tenant_members').delete().eq('user_id', ctx.userId);
  await admin.from('users').delete().eq('id', ctx.userId);

  const { error: deleteErr } = await admin.auth.admin.deleteUser(ctx.userId);
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message || 'Failed to delete account' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});
