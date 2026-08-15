import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Public endpoints accessible without authentication
const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/api/health',
  '/api/auth',
  '/api/widget',
  '/_next',
  '/favicon.ico',
  '/assets',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Allow public static assets and auth endpoints
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const authRequired = process.env.AUTH_REQUIRED === 'true';
  const defaultTenantId = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
  const configuredSecret = process.env.API_SECRET_KEY;

  // Extract credentials
  const authHeader = request.headers.get('authorization');
  const apiKeyHeader = request.headers.get('x-api-key');
  const sessionCookie = request.cookies.get('sb-access-token')?.value || request.cookies.get('supabase-auth-token')?.value;

  let token: string | undefined = apiKeyHeader || undefined;
  if (!token && authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (!token && sessionCookie) {
    token = sessionCookie;
  }

  let resolvedTenantId = defaultTenantId;
  let resolvedUserId = '00000000-0000-0000-0000-000000000001';
  let resolvedUserRole = 'admin';
  let isAuthenticated = false;

  // Verify token
  if (token) {
    if (configuredSecret && token === configuredSecret) {
      isAuthenticated = true;
      resolvedUserRole = 'admin';
    } else {
      // Decode JWT payload if valid format
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
          if (payload.exp && payload.exp * 1000 > Date.now()) {
            isAuthenticated = true;
            resolvedUserId = payload.sub || resolvedUserId;
            resolvedTenantId = payload.app_metadata?.tenant_id || payload.user_metadata?.tenant_id || defaultTenantId;
            resolvedUserRole = payload.app_metadata?.role || payload.user_metadata?.role || 'operator';
          }
        }
      } catch (_) {
        // Invalid JWT structure
      }
    }
  }

  // If AUTH_REQUIRED is active, reject unauthenticated access
  if (authRequired && !isAuthenticated) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized: Authentication required' },
        { status: 401 }
      );
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Forward resolved context via headers to downstream handlers
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-tenant-id', resolvedTenantId);
  requestHeaders.set('x-user-id', resolvedUserId);
  requestHeaders.set('x-user-role', resolvedUserRole);
  if (token) {
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
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
