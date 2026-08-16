import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAdminRecord } from '@/lib/platform-admin-guard';

export const dynamic = 'force-dynamic';

/**
 * Self-identity check: "is the currently authenticated user a platform
 * admin?". Deliberately NOT wrapped in withPlatformAdminAuth -- that wrapper
 * is for admin-only routes and 403s non-admins, but every user (admin or
 * not) is entitled to know their own platform-admin status, and the login
 * flow calls this for every user to decide where to route them. Returning
 * 403 for the common "not an admin" case just produces a noisy failed
 * request in the browser console for ordinary logins.
 */
export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id') || undefined;
  const email = req.headers.get('x-user-email');
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const data = await getPlatformAdminRecord(email, userId);

  return NextResponse.json({
    email,
    platformRole: data?.platform_role ?? null,
  });
}
