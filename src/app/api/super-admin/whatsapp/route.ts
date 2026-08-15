import { NextRequest, NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// NOTE: the current WhatsApp integration runs a single shared Baileys
// session per deployment (whatsapp_connection_state/whatsapp_session_lock
// are keyed by a literal 'default' channel_id, not per-tenant -- see
// src/lib/whatsapp-leader.ts). This endpoint reports that live session's
// state plus the per-tenant `channels` rows (which do carry tenant_id) so
// the panel is honest about what's actually per-tenant today vs. shared.
export const GET = withPlatformAdminAuth(async (req: NextRequest) => {
  const admin = getSupabaseAdmin();
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1);
  const pageSize = 10;

  const [{ data: connectionState }, { data: sessionLock }, { data: channelRows, count: channelsTotal }, { count: queuePending }] = await Promise.all([
    admin.from('whatsapp_connection_state').select('*').eq('channel_id', 'default').maybeSingle(),
    admin.from('whatsapp_session_lock').select('*').eq('channel_id', 'default').maybeSingle(),
    admin
      .from('channels')
      .select('id, tenant_id, status, display_name, external_account_id, updated_at, tenants(name, slug)', { count: 'exact' })
      .eq('type', 'whatsapp')
      .order('updated_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1),
    admin.from('whatsapp_outbound_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);

  return NextResponse.json({
    liveConnection: {
      status: connectionState?.status || 'unknown',
      account: connectionState?.account || null,
      lastDisconnect: connectionState?.last_disconnect || null,
      connectingSince: connectionState?.connecting_since || null,
      updatedAt: connectionState?.updated_at || null,
      leaderHolderId: sessionLock?.holder_id || null,
      leaseExpiresAt: sessionLock?.lease_expires_at || null,
      leaseTerm: sessionLock?.term || null,
    },
    tenantChannels: (channelRows || []).map((c: any) => ({
      id: c.id,
      tenantId: c.tenant_id,
      tenantName: c.tenants?.name,
      tenantSlug: c.tenants?.slug,
      status: c.status,
      displayName: c.display_name,
      externalAccountId: c.external_account_id,
      updatedAt: c.updated_at,
    })),
    tenantChannelsTotal: channelsTotal || 0,
    page,
    pageSize,
    outboundQueuePending: queuePending || 0,
  });
}, { roles: ['super_admin', 'auditor'] });
