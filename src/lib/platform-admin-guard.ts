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
 * Resolves the caller's platform-admin identity, independent of tenant RBAC.
 * Trusts x-user-id/x-user-email (cryptographically verified upstream by
 * middleware.ts against the Supabase JWT) but never trusts x-user-role,
 * which is tenant-scoped and must not grant platform access.
 */
async function resolvePlatformContext(req: NextRequest): Promise<PlatformContext | null> {
  const userId = req.headers.get('x-user-id') || undefined;
  const email = req.headers.get('x-user-email');
  if (!email) return null;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('platform_admins')
    .select('user_id, email, platform_role, revoked_at')
    .eq('email', email.toLowerCase())
    .is('revoked_at', null)
    .maybeSingle();

  if (error || !data) return null;

  // Opportunistically backfill user_id once the admin has a resolved auth identity.
  if (userId && !data.user_id) {
    await admin.from('platform_admins').update({ user_id: userId }).eq('email', data.email);
  }

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
// Overloaded so the wrapped export's declared type exactly matches what
// Next.js's generated per-route param check expects: routes with no dynamic
// segment get a handler with no second parameter at all, while routes with
// a [param] segment get one with a required, exact RouteContext -- a single
// signature with an optional/union param satisfies neither check.
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
