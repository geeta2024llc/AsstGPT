import { NextRequest, NextResponse } from 'next/server';
import { runWithRequestContext, RequestContext } from './request-context';
import type { UserRole } from '@/types';

export interface ApiAuthOptions {
  roles?: UserRole[];
  allowPublic?: boolean;
}

/**
 * Higher-order API route wrapper that establishes RequestContext AsyncLocalStorage
 * and enforces Role-Based Access Control (RBAC) on incoming requests.
 * Supports both static routes and dynamic parameter routes.
 */
export function withApiAuth(
  handler: (req: NextRequest, ctx: RequestContext) => Promise<NextResponse>,
  options?: ApiAuthOptions
): (req: NextRequest) => Promise<NextResponse>;
export function withApiAuth<RouteContext>(
  handler: (req: NextRequest, ctx: RequestContext, routeContext: RouteContext) => Promise<NextResponse>,
  options?: ApiAuthOptions
): (req: NextRequest, routeContext: RouteContext) => Promise<NextResponse>;
export function withApiAuth(
  handler: (req: NextRequest, ctx: RequestContext, routeContext?: any) => Promise<NextResponse>,
  options?: ApiAuthOptions
) {
  return async (req: NextRequest, routeContext?: any): Promise<NextResponse> => {
    const authDisabled = process.env.AUTH_REQUIRED === 'false';
    const defaultTenantId = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

    // Extract headers forwarded by verified middleware
    const tenantId = req.headers.get('x-tenant-id') || defaultTenantId;
    const userId = req.headers.get('x-user-id') || undefined;
    const userRole = (req.headers.get('x-user-role') as RequestContext['userRole']) || 'operator';
    const authHeader = req.headers.get('authorization');
    const jwtToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

    const ctx: RequestContext = {
      tenantId,
      userId,
      userRole,
      jwtToken,
    };

    // Role-based access control check
    if (!authDisabled && !options?.allowPublic && options?.roles && options.roles.length > 0) {
      const allowedRoles = options.roles as string[];
      if (!ctx.userRole || !allowedRoles.includes(ctx.userRole)) {
        return NextResponse.json(
          {
            error: 'Forbidden: Insufficient privileges to perform this operation.',
            requiredRoles: options.roles,
            currentRole: ctx.userRole,
          },
          { status: 403 }
        );
      }
    }

    // Execute handler within the established AsyncLocalStorage context
    return runWithRequestContext(ctx, () => handler(req, ctx, routeContext));
  };
}
