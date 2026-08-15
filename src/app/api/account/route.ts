import { NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/api-guard';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

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
