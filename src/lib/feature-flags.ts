import { getSupabaseAdmin } from './supabase';

if (typeof window !== 'undefined') {
  throw new Error('CRITICAL SECURITY ERROR: src/lib/feature-flags.ts is a server-only module.');
}

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;
const flagCache = new Map<string, CacheEntry>();

export function clearFeatureFlagCache(): void {
  flagCache.clear();
}

/**
 * Resolves whether a feature is enabled: a tenant-level override always
 * wins over the global default. Cached briefly since this can sit in
 * message-processing hot paths.
 */
export async function isFeatureEnabled(key: string, tenantId?: string): Promise<boolean> {
  const cacheKey = `${key}:${tenantId || 'global'}`;
  const cached = flagCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const admin = getSupabaseAdmin();

  if (tenantId) {
    const { data: override } = await admin
      .from('tenant_feature_flags')
      .select('enabled')
      .eq('tenant_id', tenantId)
      .eq('flag_key', key)
      .maybeSingle();

    if (override) {
      flagCache.set(cacheKey, { value: override.enabled, expiresAt: Date.now() + CACHE_TTL_MS });
      return override.enabled;
    }
  }

  const { data: global } = await admin
    .from('feature_flags')
    .select('enabled')
    .eq('key', key)
    .maybeSingle();

  const value = global?.enabled ?? false;
  flagCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
