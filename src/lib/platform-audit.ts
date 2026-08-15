import { getSupabaseAdmin } from './supabase';

if (typeof window !== 'undefined') {
  throw new Error('CRITICAL SECURITY ERROR: src/lib/platform-audit.ts is a server-only module.');
}

export interface PlatformAuditEntry {
  actorUserId?: string;
  actorEmail: string;
  action: string;
  targetType?: string;
  targetId?: string;
  tenantId?: string;
  ip?: string;
  metadata?: Record<string, any>;
  result?: 'success' | 'failure';
}

/**
 * Writes an append-only entry to platform_audit_logs. Never throws -- a
 * logging failure must not block or roll back the privileged operation it
 * is describing, but it is always awaited so callers can be sure the write
 * was attempted before responding to the client.
 */
export async function logPlatformAction(entry: PlatformAuditEntry): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from('platform_audit_logs').insert({
      actor_user_id: entry.actorUserId || null,
      actor_email: entry.actorEmail,
      action: entry.action,
      target_type: entry.targetType || null,
      target_id: entry.targetId || null,
      tenant_id: entry.tenantId || null,
      ip_address: entry.ip || null,
      metadata: entry.metadata || {},
      result: entry.result || 'success',
    });
    if (error) {
      console.error('[PLATFORM AUDIT] Failed to write audit log:', error);
    }
  } catch (err) {
    console.error('[PLATFORM AUDIT] Unexpected error writing audit log:', err);
  }
}
