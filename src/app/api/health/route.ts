import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getClientState } from '@/lib/whatsapp-client';

export const dynamic = 'force-dynamic';

export async function GET() {
  const timestamp = new Date().toISOString();
  let dbStatus: 'connected' | 'error' = 'error';

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('tenants').select('id').limit(1);
    if (!error) {
      dbStatus = 'connected';
    }
  } catch (err) {
    console.error('Health check DB probe error:', err);
    dbStatus = 'error';
  }

  const waState = getClientState();
  const hasGeminiKey = Boolean(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GOOGLE_API_KEY
  );

  let overallStatus: 'ok' | 'degraded' | 'error' = 'ok';
  if (dbStatus !== 'connected') {
    overallStatus = 'error';
  } else if (!hasGeminiKey) {
    overallStatus = 'error';
  } else if (waState.status !== 'connected') {
    overallStatus = 'degraded';
  }

  return NextResponse.json({
    status: overallStatus,
    timestamp,
    application: 'AIWhisper AI Support Engine',
    environment: process.env.NODE_ENV || 'production',
    checks: {
      database: dbStatus,
      whatsApp: waState.status,
      aiProvider: 'gemini',
      aiConfigured: hasGeminiKey,
      whatsappAccount: waState.account ? waState.account.name : null,
    },
  });
}
