import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from './supabase';

if (typeof window !== 'undefined') {
  throw new Error('CRITICAL SECURITY ERROR: src/lib/platform-admin-guard.ts is a server-only module.');
}

export type PlatformRole = 'super_admin' | 'auditor';

export interface PlatformContext {
  userId?: string;
  email: string;
  platformRole: PlatformRole;
  ip: string;
}

/**
 * Retrieves the platform admin record from public.platform_admins.
 * Auto-bootstraps designated super admin emails from the SUPER_ADMIN_EMAILS
 * env var only -- never a literal baked into source. A hardcoded identity
 * in the codebase can never actually be revoked (the very next login would
 * just re-create it) and is trivially discoverable by anyone who can read
 * the repo.
 */
export async function getPlatformAdminRecord(email: string, userId?: string) {
  const normalizedEmail = email.toLowerCase().trim();
  const admin = getSupabaseAdmin();

  // Fetch regardless of revocation status -- revocation is checked once,
  // centrally, below, so it applies uniformly whether the row came from
  // this query or from the auto-bootstrap upsert.
  let { data } = await admin
    .from('platform_admins')
    .select('user_id, email, platform_role, revoked_at')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (!data) {
    const envSuperAdmins = (process.env.SUPER_ADMIN_EMAILS || process.env.SUPER_ADMIN_EMAIL || '')
      .toLowerCase()
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    if (envSuperAdmins.includes(normalizedEmail)) {
      const { data: inserted, error: insertErr } = await admin
        .from('platform_admins')
        .upsert(
          {
            email: normalizedEmail,
            platform_role: 'super_admin',
            user_id: userId || null,
          },
          { onConflict: 'email' }
        )
        .select('user_id, email, platform_role, revoked_at')
        .single();

      if (!insertErr && inserted) {
        data = inserted;
      }
    }
  } else if (userId && !data.user_id) {
    await admin.from('platform_admins').update({ user_id: userId }).eq('email', data.email);
  }

  // A revoked row must never be treated as valid, on any path above.
  if (data?.revoked_at) {
    return null;
  }

  return data;
}

/**
 * Resolves the caller's platform-admin identity, independent of tenant RBAC.
 * Trusts x-user-id/x-user-email (cryptographically verified upstream by
 * middleware.ts against the Supabase JWT) but never trusts x-user-role,
 * which is tenant-scoped and must not grant platform access.
 */
async function resolvePlatformContext(req: NextRequest): Promise<PlatformContext | null> {
  const userId = req.headers.get('x-user-id') || undefined;
  const email = req.headers.get('x-user-email');
  if (!email) return null;

  const data = await getPlatformAdminRecord(email, userId);
  if (!data) return null;

  const forwardedFor = req.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';

  return {
    userId: userId || data.user_id || undefined,
    email: data.email,
    platformRole: data.platform_role as PlatformRole,
    ip,
  };
}

export interface PlatformAuthOptions {
  /** Platform roles allowed to call this route. Defaults to super_admin only. */
  roles?: PlatformRole[];
}

/**
 * Route wrapper enforcing the platform-admin authorization boundary. This is
 * deliberately separate from withApiAuth()/tenant RBAC in api-guard.ts --
 * a tenant owner/admin has zero standing here unless they also have a row
 * in platform_admins.
 */
export function withPlatformAdminAuth(
  handler: (req: NextRequest, ctx: PlatformContext) => Promise<NextResponse>,
  options?: PlatformAuthOptions
): (req: NextRequest) => Promise<NextResponse>;
export function withPlatformAdminAuth<RouteContext>(
  handler: (req: NextRequest, ctx: PlatformContext, routeContext: RouteContext) => Promise<NextResponse>,
  options?: PlatformAuthOptions
): (req: NextRequest, routeContext: RouteContext) => Promise<NextResponse>;
export function withPlatformAdminAuth(
  handler: (req: NextRequest, ctx: PlatformContext, routeContext?: any) => Promise<NextResponse>,
  options?: PlatformAuthOptions
) {
  const allowedRoles = options?.roles || ['super_admin'];

  return async (req: NextRequest, routeContext?: any): Promise<NextResponse> => {
    const ctx = await resolvePlatformContext(req);

    if (!ctx || !allowedRoles.includes(ctx.platformRole)) {
      return NextResponse.json(
        { error: 'Forbidden: super admin access required.' },
        { status: 403 }
      );
    }

    return handler(req, ctx, routeContext);
  };
}
