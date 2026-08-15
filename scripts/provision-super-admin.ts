import 'dotenv/config';
import { getSupabaseAdmin } from '../src/lib/supabase';

/**
 * Creates (or reuses) a Supabase Auth account for a seeded platform_admins
 * email and backfills platform_admins.user_id -- deliberately does NOT
 * attach any tenant_id/role app_metadata, so this account never belongs to
 * a tenant workspace, only the platform-admin boundary.
 *
 * Usage: npx tsx scripts/provision-super-admin.ts <email> [password]
 */
function randomPassword(): string {
  return `Sa-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}!`;
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const password = process.argv[3] || randomPassword();

  if (!email) {
    console.error('Usage: npx tsx scripts/provision-super-admin.ts <email> [password]');
    process.exit(1);
  }

  const admin = getSupabaseAdmin();

  const { data: existingAdmin, error: lookupErr } = await admin
    .from('platform_admins')
    .select('id, email, revoked_at, user_id')
    .eq('email', email)
    .maybeSingle();

  if (lookupErr || !existingAdmin) {
    console.error(`No platform_admins row found for ${email}. Seed it first (see the super_admin_platform migration) before provisioning a login.`);
    process.exit(1);
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr) {
    if (createErr.message?.toLowerCase().includes('already registered')) {
      console.log(`An auth account for ${email} already exists -- nothing to create.`);
      process.exit(0);
    }
    console.error('Failed to create auth account:', createErr.message);
    process.exit(1);
  }

  if (!created?.user) {
    console.error('createUser returned no user unexpectedly.');
    process.exit(1);
  }

  await admin.from('platform_admins').update({ user_id: created.user.id }).eq('email', email);

  console.log(`Provisioned super admin account for ${email}.`);
  console.log(`Temporary password: ${password}`);
  console.log('Log in with this password, then change it from the account settings.');
}

main().catch((err) => {
  console.error('Provisioning error:', err);
  process.exit(1);
});
