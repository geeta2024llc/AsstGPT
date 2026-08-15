import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPlatformAdminRecord } from '@/lib/platform-admin-guard';
import SuperAdminShell from '@/components/super-admin-shell';

/**
 * Server-side platform-admin gate. Deliberately independent of tenant RBAC:
 * checks platform_admins by the email middleware.ts already verified against
 * the Supabase JWT (x-user-email), never trusting x-user-role.
 */
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const email = headerList.get('x-user-email');
  const userId = headerList.get('x-user-id') || undefined;

  if (!email) {
    redirect('/login');
  }

  const data = await getPlatformAdminRecord(email, userId);

  if (!data) {
    redirect('/login');
  }

  return <SuperAdminShell email={email}>{children}</SuperAdminShell>;
}
