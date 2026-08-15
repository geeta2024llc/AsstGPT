import { NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { logPlatformAction } from '@/lib/platform-audit';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withPlatformAdminAuth<RouteContext>(async (req, ctx, routeContext) => {
  const { id } = await routeContext.params;
  const body = await req.json().catch(() => ({}));
  const admin = getSupabaseAdmin();

  const action = body.action || 'update';

  // 1. Handle Ban / Unban
  if (action === 'ban' || action === 'unban') {
    const banDuration = action === 'ban' ? '876000h' : 'none'; // ~100 years == indefinite

    const { data, error } = await admin.auth.admin.updateUserById(id, { ban_duration: banDuration });
    if (error || !data?.user) {
      return NextResponse.json({ error: error?.message || 'User not found' }, { status: 404 });
    }

    await logPlatformAction({
      actorUserId: ctx.userId,
      actorEmail: ctx.email,
      action: action === 'ban' ? 'user.ban' : 'user.unban',
      targetType: 'user',
      targetId: id,
      ip: ctx.ip,
      metadata: { targetEmail: data.user.email, reason: body.reason },
    });

    return NextResponse.json({
      id: data.user.id,
      email: data.user.email,
      bannedUntil: (data.user as any).banned_until || null,
      isBanned: action === 'ban',
    });
  }

  // 2. Handle Update (role, password, email, organization, full name)
  if (action === 'update') {
    const { email, password, fullName, role, tenantId } = body;

    const authUpdates: any = {};
    if (email) authUpdates.email = email.trim().toLowerCase();
    if (password && password.length >= 8) authUpdates.password = password;
    if (fullName !== undefined) {
      authUpdates.user_metadata = { full_name: fullName };
    }

    // Retrieve existing user to know current metadata
    const { data: existingUser, error: fetchErr } = await admin.auth.admin.getUserById(id);
    if (fetchErr || !existingUser?.user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const currentAppMeta = existingUser.user.app_metadata || {};
    const updatedTenantId = tenantId || currentAppMeta.tenant_id;
    const updatedRole = role || currentAppMeta.role;

    if (tenantId || role) {
      authUpdates.app_metadata = {
        ...currentAppMeta,
        ...(tenantId ? { tenant_id: tenantId } : {}),
        ...(role ? { role } : {}),
      };
    }

    // Apply Supabase Auth updates
    const { data: updatedAuth, error: updateErr } = await admin.auth.admin.updateUserById(id, authUpdates);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 400 });
    }

    // Sync public.users table if full_name or email changed
    if (email || fullName !== undefined) {
      await admin.from('users').update({
        ...(email ? { email: email.trim().toLowerCase() } : {}),
        ...(fullName !== undefined ? { full_name: fullName } : {}),
      }).eq('id', id);
    }

    // Sync tenant_members if tenantId or role changed
    if (tenantId || role) {
      if (tenantId && tenantId !== currentAppMeta.tenant_id) {
        // Reassign organization
        await admin.from('tenant_members').delete().eq('user_id', id);
        await admin.from('tenant_members').insert({
          tenant_id: tenantId,
          user_id: id,
          role: updatedRole || 'admin',
        });
      } else if (role) {
        // Update role in existing organization
        await admin.from('tenant_members').update({ role }).eq('user_id', id);
      }
    }

    await logPlatformAction({
      actorUserId: ctx.userId,
      actorEmail: ctx.email,
      action: 'user.update',
      targetType: 'user',
      targetId: id,
      tenantId: updatedTenantId,
      ip: ctx.ip,
      metadata: {
        targetEmail: updatedAuth.user.email,
        updatedFields: Object.keys(body).filter((k) => k !== 'action' && k !== 'password'),
        hasPasswordReset: !!password,
        newRole: updatedRole,
        newTenantId: updatedTenantId,
      },
    });

    return NextResponse.json({
      id: updatedAuth.user.id,
      email: updatedAuth.user.email,
      fullName: updatedAuth.user.user_metadata?.full_name,
      role: updatedRole,
      tenantId: updatedTenantId,
      updatedAt: new Date().toISOString(),
    });
  }

  return NextResponse.json({ error: 'Invalid action. Must be "ban", "unban", or "update"' }, { status: 400 });
}, { roles: ['super_admin'] });

export const DELETE = withPlatformAdminAuth<RouteContext>(async (_req, ctx, routeContext) => {
  const { id } = await routeContext.params;
  const admin = getSupabaseAdmin();

  // Guard against self-deletion
  if (ctx.userId && id === ctx.userId) {
    return NextResponse.json({ error: 'Cannot delete your own platform administrator account' }, { status: 400 });
  }

  // Fetch target user for audit records
  const { data: targetUser } = await admin.auth.admin.getUserById(id);
  const targetEmail = targetUser?.user?.email || 'unknown';
  const targetTenantId = targetUser?.user?.app_metadata?.tenant_id;

  // 1. Remove tenant memberships
  await admin.from('tenant_members').delete().eq('user_id', id);

  // 2. Remove public.users record
  await admin.from('users').delete().eq('id', id);

  // 3. Delete from Supabase Auth
  const { error: deleteErr } = await admin.auth.admin.deleteUser(id);
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message || 'Failed to delete user' }, { status: 500 });
  }

  // 4. Record immutable audit log
  await logPlatformAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: 'user.delete',
    targetType: 'user',
    targetId: id,
    tenantId: targetTenantId,
    ip: ctx.ip,
    metadata: {
      targetEmail,
      deletedAt: new Date().toISOString(),
    },
  });

  return NextResponse.json({
    success: true,
    deletedUserId: id,
    deletedEmail: targetEmail,
  });
}, { roles: ['super_admin'] });
