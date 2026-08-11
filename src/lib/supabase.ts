import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

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

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
