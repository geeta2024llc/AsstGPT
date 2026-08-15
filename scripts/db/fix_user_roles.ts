import 'dotenv/config';
import { getSupabaseAdmin } from '../../src/lib/supabase';

async function main() {
  const admin = getSupabaseAdmin();

  console.log('--- 1. Fetching all Auth Users ---');
  const { data: authUsers, error: authErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (authErr) {
    console.error('Error listing auth users:', authErr);
    return;
  }

  console.log('Found Auth users:', authUsers.users.map(u => ({ id: u.id, email: u.email, app_metadata: u.app_metadata })));

  console.log('\n--- 2. Checking platform_admins table ---');
  const { data: platformAdmins, error: paErr } = await admin.from('platform_admins').select('*');
  console.log('platform_admins rows:', platformAdmins, paErr || '');

  console.log('\n--- 3. Checking tenant_members table ---');
  const { data: tenantMembers, error: tmErr } = await admin.from('tenant_members').select('*');
  console.log('tenant_members rows:', tenantMembers, tmErr || '');

  // 1. Ensure geeta2024llc@gmail.com and gita2024llc@gmail.com are super_admin in platform_admins
  const superAdminEmails = ['geeta2024llc@gmail.com', 'gita2024llc@gmail.com'];
  for (const sEmail of superAdminEmails) {
    const user = authUsers.users.find(u => u.email?.toLowerCase() === sEmail.toLowerCase());
    const userId = user?.id || null;

    const { error: upsertErr } = await admin.from('platform_admins').upsert({
      email: sEmail.toLowerCase(),
      platform_role: 'super_admin',
      user_id: userId,
      revoked_at: null,
    }, { onConflict: 'email' });

    if (upsertErr) {
      console.error(`Failed to upsert platform_admin for ${sEmail}:`, upsertErr);
    } else {
      console.log(`Successfully ensured ${sEmail} is super_admin in platform_admins (user_id: ${userId})`);
    }

    if (user) {
      await admin.auth.admin.updateUserById(user.id, {
        app_metadata: { ...user.app_metadata, role: 'super_admin' },
      });
      console.log(`Updated app_metadata.role = 'super_admin' for ${sEmail}`);
    }
  }

  // 2. Ensure asst.dosm.opl@gmail.com has role 'admin'
  const adminEmail = 'asst.dosm.opl@gmail.com';
  const adminUser = authUsers.users.find(u => u.email?.toLowerCase() === adminEmail.toLowerCase());
  if (adminUser) {
    // Update app_metadata
    await admin.auth.admin.updateUserById(adminUser.id, {
      app_metadata: { ...adminUser.app_metadata, role: 'admin' },
    });
    console.log(`Updated app_metadata.role = 'admin' for ${adminEmail}`);

    // Update tenant_members
    const { error: tmUpdateErr } = await admin
      .from('tenant_members')
      .update({ role: 'admin' })
      .eq('user_id', adminUser.id);

    if (tmUpdateErr) {
      console.error(`Failed to update tenant_members for ${adminEmail}:`, tmUpdateErr);
    } else {
      console.log(`Updated tenant_members.role = 'admin' for ${adminEmail}`);
    }
  } else {
    console.log(`Could not find Auth user for ${adminEmail}`);
  }

  console.log('\n--- 4. Verification Check ---');
  const { data: finalAuth } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  for (const u of finalAuth?.users || []) {
    console.log(`User: ${u.email} | app_metadata:`, u.app_metadata);
  }
}

main().catch(console.error);
