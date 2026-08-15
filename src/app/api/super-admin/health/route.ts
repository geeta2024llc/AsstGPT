import { NextResponse } from 'next/server';
import { withPlatformAdminAuth } from '@/lib/platform-admin-guard';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withPlatformAdminAuth(async () => {
  const admin = getSupabaseAdmin();

  let dbReachable = true;
  try {
    const { error } = await admin.from('tenants').select('id', { count: 'exact', head: true }).limit(1);
    dbReachable = !error;
  } catch {
    dbReachable = false;
  }

  const [{ count: connected }, { count: disconnected }, { count: queuePending }, { count: queueFailed }] = await Promise.all([
    admin.from('channels').select('id', { count: 'exact', head: true }).eq('type', 'whatsapp').eq('status', 'connected'),
    admin.from('channels').select('id', { count: 'exact', head: true }).eq('type', 'whatsapp').neq('status', 'connected'),
    admin.from('whatsapp_outbound_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('whatsapp_outbound_queue').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
  ]);

  const providerKeysConfigured = {
    gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY),
    groq: !!(process.env.GROQ_API_KEY || process.env.GROQ_KEY),
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
  };

  return NextResponse.json({
    database: { reachable: dbReachable },
    whatsapp: { connected: connected || 0, disconnected: disconnected || 0 },
    outboundQueue: { pending: queuePending || 0, failed: queueFailed || 0 },
    aiProviders: providerKeysConfigured,
    serverUptimeSeconds: Math.round(process.uptime()),
    checkedAt: new Date().toISOString(),
  });
}, { roles: ['super_admin', 'auditor'] });
