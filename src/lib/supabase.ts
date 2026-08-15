import { createClient } from '@supabase/supabase-js';
import { getRequestContext } from './request-context';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://placeholder.supabase.co';

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'placeholder-anon-key';

/**
 * Checks if Supabase has been properly configured with real, non-placeholder credentials.
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) return false;
  if (url.includes('placeholder') || key.includes('placeholder')) return false;

  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname.includes('placeholder');
  } catch {
    return false;
  }
}

/**
 * Standard Supabase client for browser / client-side and authenticated RLS user operations.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Server-only Supabase client using SUPABASE_SERVICE_ROLE_KEY.
 * Bypasses RLS policies for backend tasks (e.g. WhatsApp message ingestion via Baileys).
 * 
 * IMPORTANT: This client must ONLY be invoked in server-side contexts.
 */
export function getSupabaseAdmin() {
  if (typeof window !== 'undefined') {
    throw new Error('CRITICAL SECURITY ERROR: getSupabaseAdmin() must never be called on the client side.');
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('[SECURITY ERROR] SUPABASE_SERVICE_ROLE_KEY environment variable is missing.');
  }

  const adminUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || supabaseUrl;

  return createClient(adminUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Returns a Supabase client configured for the current execution context.
 * If a user JWT token is present in RequestContext, sets the Authorization header
 * so that PostgreSQL Row-Level Security (RLS) policies are enforced.
 * Otherwise falls back to service role admin client for background ingestion.
 */
export function getDb() {
  const ctx = getRequestContext();
  if (ctx?.jwtToken) {
    return createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${ctx.jwtToken}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return getSupabaseAdmin();
}
