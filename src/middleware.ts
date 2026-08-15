import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { timingSafeCompare } from '@/lib/security-utils';

// Public endpoints accessible without authentication
const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/invite',
  '/api/health',
  '/api/auth',
  '/api/invite',
  '/api/widget',
  '/_next',
  '/favicon.ico',
  '/assets',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Allow public static assets and auth endpoints
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Secure-by-default: fail closed unless explicitly set to 'false' in local development
  const authDisabled = process.env.AUTH_REQUIRED === 'false';
  const defaultTenantId = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
  const configuredSecret = process.env.API_SECRET_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  // Extract credentials from headers or cookies
  const authHeader = request.headers.get('authorization');
  const apiKeyHeader = request.headers.get('x-api-key');
  const sessionCookie =
    request.cookies.get('sb-access-token')?.value ||
    request.cookies.get('supabase-auth-token')?.value;

  let token: string | undefined = apiKeyHeader || undefined;
  if (!token && authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (!token && sessionCookie) {
    token = sessionCookie;
  }

  let resolvedTenantId = defaultTenantId;
  let resolvedUserId = '00000000-0000-0000-0000-000000000001';
  let resolvedUserRole = 'admin';
  let resolvedUserEmail = '';
  let isAuthenticated = false;
  let checkTenantSuspension = false;

  // 2. Cryptographic Token Verification
  if (token) {
    // A. Check against configured system API secret (timing-safe)
    if (configuredSecret && timingSafeCompare(token, configuredSecret)) {
      isAuthenticated = true;
      resolvedUserRole = 'admin';
      resolvedTenantId = request.headers.get('x-tenant-id') || defaultTenantId;
    } else if (supabaseUrl && supabaseAnonKey && !token.includes('placeholder')) {
      // B. Cryptographically verify Supabase User JWT against Supabase Auth API
      try {
        const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: supabaseAnonKey,
          },
          signal: AbortSignal.timeout(3500),
        });

        if (authRes.ok) {
          const user = await authRes.json();
          if (user?.id) {
            isAuthenticated = true;
            resolvedUserId = user.id;
            resolvedUserEmail = user.email || '';
            resolvedTenantId =
              user.app_metadata?.tenant_id ||
              user.user_metadata?.tenant_id ||
              defaultTenantId;
            resolvedUserRole =
              user.app_metadata?.role ||
              user.user_metadata?.role ||
              'operator';
            checkTenantSuspension = true;
          }
        }
      } catch (_) {
        // Network timeout or unverified token
      }
    }
  }

  // 3. If authentication is not disabled and user is unauthenticated, reject access
  if (!authDisabled && !isAuthenticated) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid cryptographic authentication token required' },
        { status: 401 }
      );
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 3b. Reject requests from members of a super-admin-suspended tenant.
  // Fail-closed on any error, consistent with the auth check above.
  if (!authDisabled && checkTenantSuspension && supabaseUrl && supabaseAnonKey) {
    try {
      const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/check_tenant_active`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({ p_tenant_id: resolvedTenantId }),
        signal: AbortSignal.timeout(3500),
      });

      const tenantActive = rpcRes.ok && (await rpcRes.json()) === true;
      if (!tenantActive) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json(
            { error: 'Forbidden: this workspace has been suspended.' },
            { status: 403 }
          );
        }
        const suspendedUrl = new URL('/login', request.url);
        suspendedUrl.searchParams.set('suspended', '1');
        return NextResponse.redirect(suspendedUrl);
      }
    } catch (_) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Forbidden: unable to verify workspace status.' },
          { status: 403 }
        );
      }
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  // 4. Forward verified claims downstream to API route handlers and Server Components
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-tenant-id', resolvedTenantId);
  requestHeaders.set('x-user-id', resolvedUserId);
  requestHeaders.set('x-user-role', resolvedUserRole);
  requestHeaders.set('x-user-email', resolvedUserEmail);
  if (token && isAuthenticated) {
    requestHeaders.set('authorization', `Bearer ${token}`);
  }

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
