import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase';
import SuperAdminShell from '@/components/super-admin-shell';

/**
 * Server-side platform-admin gate. Deliberately independent of tenant RBAC:
 * checks platform_admins by the email middleware.ts already verified against
 * the Supabase JWT (x-user-email), never trusting x-user-role.
 */
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const email = headerList.get('x-user-email');

  if (!email) {
    redirect('/login');
  }

  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('platform_admins')
    .select('platform_role, revoked_at')
    .eq('email', email.toLowerCase())
    .is('revoked_at', null)
    .maybeSingle();

  if (!data) {
    redirect('/dashboard');
  }

  return <SuperAdminShell email={email}>{children}</SuperAdminShell>;
}
