import { NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { logPlatformAction } from '@/lib/platform-audit';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ channelId: string }> };

/**
 * Destructive action: forces the shared WhatsApp session to log out and
 * clear its auth state so a fresh QR pairing is required. The live Baileys
 * socket only exists in-process on whichever replica currently holds
 * leadership, so logout()/init() are called best-effort here (they no-op
 * safely if this replica isn't the leader) and the lock/state rows are
 * cleared directly so the leader picks up the reset on its next lease check.
 */
export const POST = withPlatformAdminAuth<RouteContext>(async (_req, ctx, routeContext) => {
  const { channelId } = await routeContext.params;
  const admin = getSupabaseAdmin();

  await admin.from('whatsapp_connection_state').delete().eq('channel_id', channelId);
  await admin.from('whatsapp_session_lock').delete().eq('channel_id', channelId);

  let inProcessResetAttempted = false;
  try {
    const whatsappClient = await import('@/lib/whatsapp-client');
    await whatsappClient.logout();
    inProcessResetAttempted = true;
  } catch (err) {
    console.warn('[SUPER ADMIN] In-process WhatsApp reset skipped (not the active leader or client unavailable):', err);
  }

  await logPlatformAction({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: 'whatsapp.force_reset',
    targetType: 'whatsapp_channel',
    targetId: channelId,
    ip: ctx.ip,
    metadata: { inProcessResetAttempted },
  });

  return NextResponse.json({ ok: true, inProcessResetAttempted });
});
