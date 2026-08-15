import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { withApiAuth } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tenant/switch: Returns all workspaces the authenticated user belongs to.
 */
export const GET = withApiAuth(
  async (_request: NextRequest, ctx) => {
    try {
      if (!ctx.userId) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }

      const admin = getSupabaseAdmin();

      const { data: memberships, error } = await admin
        .from('tenant_members')
        .select(`
          tenant_id,
          role,
          created_at,
          tenants:tenant_id (
            id,
            name,
            slug,
            is_active
          )
        `)
        .eq('user_id', ctx.userId);

      if (error) {
        console.error('Failed to fetch user workspaces:', error);
        return NextResponse.json({ message: 'Failed to fetch workspaces' }, { status: 500 });
      }

      const workspaces = (memberships || [])
        .filter((m: any) => m.tenants && m.tenants.is_active !== false)
        .map((m: any) => ({
          tenantId: m.tenant_id,
          name: m.tenants.name,
          slug: m.tenants.slug,
          role: m.role,
          isActive: m.tenant_id === ctx.tenantId,
        }));

      return NextResponse.json({ workspaces, currentTenantId: ctx.tenantId });
    } catch (error: any) {
      console.error('Failed to get user workspaces:', error);
      return NextResponse.json({ message: error.message || 'Failed to get workspaces' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);

/**
 * POST /api/tenant/switch: Switches the user's active workspace session by updating app_metadata.
 */
export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      if (!ctx.userId) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }

      const body = await request.json();
      const { targetTenantId } = body;

      if (!targetTenantId || typeof targetTenantId !== 'string') {
        return NextResponse.json({ message: 'targetTenantId is required' }, { status: 400 });
      }

      const admin = getSupabaseAdmin();

      // 1. Verify user is an active member in targetTenantId
      const { data: membership, error: memErr } = await admin
        .from('tenant_members')
        .select('role')
        .eq('tenant_id', targetTenantId)
        .eq('user_id', ctx.userId)
        .maybeSingle();

      if (memErr || !membership) {
        return NextResponse.json(
          { message: 'You are not a member of the requested workspace' },
          { status: 403 }
        );
      }

      // 2. Verify target tenant is active (not suspended)
      const { data: tenant } = await admin
        .from('tenants')
        .select('id, name, slug, is_active')
        .eq('id', targetTenantId)
        .maybeSingle();

      if (!tenant || tenant.is_active === false) {
        return NextResponse.json(
          { message: 'Target workspace is currently suspended or inaccessible' },
          { status: 403 }
        );
      }

      // 3. Stamp target workspace & role into Auth app_metadata
      const { error: updateErr } = await admin.auth.admin.updateUserById(ctx.userId, {
        app_metadata: {
          tenant_id: targetTenantId,
          role: membership.role,
        },
      });

      if (updateErr) {
        console.error('Failed to update app_metadata for workspace switch:', updateErr);
        return NextResponse.json({ message: 'Failed to switch workspace' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        tenantId: targetTenantId,
        tenantName: tenant.name,
        role: membership.role,
      });
    } catch (error: any) {
      console.error('Failed to switch workspace:', error);
      return NextResponse.json({ message: error.message || 'Failed to switch workspace' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator', 'viewer'] }
);
