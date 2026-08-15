import { NextRequest, NextResponse } from 'next/server';
import { getWidgetConfig, updateWidgetConfig, ensureDefaultTenantAndChannel, addLog } from '@/lib/db';
import { getSupabaseAdmin } from '@/lib/supabase';
import { signWidgetSession } from '@/lib/security-utils';
import { withApiAuth } from '@/lib/api-guard';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceParam =
      searchParams.get('key') ||
      searchParams.get('workspace') ||
      searchParams.get('tenantId') ||
      request.headers.get('x-widget-key');

    let targetTenantId: string;

    if (workspaceParam) {
      const supabase = getSupabaseAdmin();
      // Lookup tenant by id or slug
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id, is_active')
        .or(`id.eq.${workspaceParam},slug.eq.${workspaceParam}`)
        .maybeSingle();

      if (!tenant) {
        return NextResponse.json({ message: 'Invalid or unknown workspace identifier' }, { status: 404 });
      }
      if (tenant.is_active === false) {
        return NextResponse.json({ message: 'This workspace is currently suspended' }, { status: 403 });
      }
      targetTenantId = tenant.id;
    } else {
      const { tenantId } = await ensureDefaultTenantAndChannel();
      targetTenantId = tenantId;
    }

    const config = await getWidgetConfig(targetTenantId);
    const existingSessionId = searchParams.get('sessionId');
    const sessionId = existingSessionId || `sess_${crypto.randomUUID()}`;
    const sessionToken = signWidgetSession(sessionId, targetTenantId);

    return NextResponse.json(
      {
        ...config,
        sessionId,
        sessionToken,
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Widget-Token, X-Widget-Key',
        },
      }
    );
  } catch (error) {
    console.error('Failed to get widget config:', error);
    return NextResponse.json({ message: 'Failed to fetch widget config' }, { status: 500 });
  }
}

export const POST = withApiAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json();
      const updated = await updateWidgetConfig(body, ctx.tenantId);

      await addLog({
        user: ctx.userId || 'Administrator',
        action: 'Widget Config Updated',
        details: `Updated live chat widget branding and greeting settings`,
        type: 'info',
      });

      return NextResponse.json(updated, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
      });
    } catch (error: any) {
      console.error('Failed to update widget config:', error);
      return NextResponse.json({ message: error.message || 'Failed to update widget config' }, { status: 500 });
    }
  },
  { roles: ['admin', 'operator'] }
);

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Widget-Token, X-Widget-Key, Authorization',
    },
  });
}
