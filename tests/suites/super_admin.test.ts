import 'dotenv/config';
import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '../../src/lib/supabase';
import { withPlatformAdminAuth } from '../../src/lib/platform-admin-guard';
import { PATCH as organizationPatch, DELETE as organizationDelete } from '../../src/app/api/super-admin/organizations/[id]/route';
import { GET as organizationsListGet } from '../../src/app/api/super-admin/organizations/route';
import { GET as usersListGet, POST as userCreate } from '../../src/app/api/super-admin/users/route';
import { PATCH as userPatch, DELETE as userDelete } from '../../src/app/api/super-admin/users/[id]/route';
import { POST as impersonateStart } from '../../src/app/api/super-admin/impersonate/route';
import { GET as meGet } from '../../src/app/api/super-admin/me/route';

const TEST_ADMIN_EMAIL = 'super-admin-test@aiwhisper.internal';
const TEST_TENANT_ID = '00000000-0000-0000-0000-0000000000a1';
const TEST_ADMIN_USER_ID = '00000000-0000-0000-0000-0000000000b1';

function makeRequest(url: string, opts: { method?: string; headers?: Record<string, string>; body?: any } = {}) {
  return new NextRequest(url, {
    method: opts.method || 'GET',
    headers: opts.headers || {},
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
}

export async function runSuperAdminTestSuite(): Promise<boolean> {
  console.log('============================================================');
  console.log('  SUPER ADMIN PLATFORM PANEL TEST SUITE');
  console.log('============================================================\n');

  let allPassed = true;
  const sb = getSupabaseAdmin();
  let testUserId: string | null = null;
  const WILDCARD_ADMIN_EMAIL = 'super_admin_ilike_test@aiwhisper.internal';
  const AUDITOR_EMAIL = 'super-admin-auditor-test@aiwhisper.internal';

  try {
    // Setup: seed a throwaway platform admin + a test tenant + a test auth user.
    await sb.from('platform_admins').upsert({ email: TEST_ADMIN_EMAIL, platform_role: 'super_admin' }, { onConflict: 'email' });
    await sb.from('tenants').upsert({ id: TEST_TENANT_ID, name: 'Super Admin Test Tenant', slug: 'super-admin-test-tenant', is_active: true });

    const { data: created } = await sb.auth.admin.createUser({
      email: `super-admin-test-victim-${Date.now()}@aiwhisper.internal`,
      password: 'Test-Password-123!',
      email_confirm: true,
    });
    testUserId = created?.user?.id || null;

    // 1. Non-admin (even a tenant owner/admin JWT) must be rejected.
    console.log('1. Testing platform-admin boundary rejects tenant-scoped identities...');
    try {
      const guarded = withPlatformAdminAuth(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }) as any);

      const tenantAdminReq = makeRequest('http://localhost:3000/api/super-admin/overview', {
        headers: { 'x-user-id': 'not-a-real-user', 'x-user-email': 'tenant-owner@example.com', 'x-user-role': 'admin' },
      });
      const res1 = await guarded(tenantAdminReq);
      const rejected = res1.status === 403;
      console.log(`   - Tenant admin (non-platform-admin) rejected: ${rejected ? '✅ PASS' : '❌ FAIL'}`);
      if (!rejected) allPassed = false;

      const noEmailReq = makeRequest('http://localhost:3000/api/super-admin/overview', {
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-role': 'admin' },
      });
      const res2 = await guarded(noEmailReq);
      const rejectedNoEmail = res2.status === 403;
      console.log(`   - Missing x-user-email rejected: ${rejectedNoEmail ? '✅ PASS' : '❌ FAIL'}`);
      if (!rejectedNoEmail) allPassed = false;

      const superAdminReq = makeRequest('http://localhost:3000/api/super-admin/overview', {
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL, 'x-user-role': 'operator' },
      });
      const res3 = await guarded(superAdminReq);
      const accepted = res3.status === 200;
      console.log(`   - Seeded platform admin accepted (x-user-role ignored): ${accepted ? '✅ PASS' : '❌ FAIL'}`);
      if (!accepted) allPassed = false;
    } catch (err) {
      console.error('   - Boundary test error:', err);
      allPassed = false;
    }

    // 2. Revoked admin is rejected.
    console.log('\n2. Testing revoked platform admin is rejected...');
    try {
      await sb.from('platform_admins').update({ revoked_at: new Date().toISOString() }).eq('email', TEST_ADMIN_EMAIL);
      const guarded = withPlatformAdminAuth(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }) as any);
      const req = makeRequest('http://localhost:3000/api/super-admin/overview', {
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL },
      });
      const res = await guarded(req);
      const rejected = res.status === 403;
      console.log(`   - Revoked admin rejected: ${rejected ? '✅ PASS' : '❌ FAIL'}`);
      if (!rejected) allPassed = false;
      await sb.from('platform_admins').update({ revoked_at: null }).eq('email', TEST_ADMIN_EMAIL);
    } catch (err) {
      console.error('   - Revocation test error:', err);
      allPassed = false;
    }

    // 3. Ban/unban via native Supabase Auth ban mechanism.
    console.log('\n3. Testing user ban/unban flips banned_until...');
    try {
      if (!testUserId) throw new Error('Test user was not created');
      const banReq = makeRequest(`http://localhost:3000/api/super-admin/users/${testUserId}`, {
        method: 'PATCH',
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL, 'Content-Type': 'application/json' },
        body: { action: 'ban' },
      });
      const banRes = await userPatch(banReq, { params: Promise.resolve({ id: testUserId }) } as any);
      const banJson = await banRes.json();
      const isBanned = banRes.status === 200 && banJson.bannedUntil && new Date(banJson.bannedUntil) > new Date();
      console.log(`   - Ban sets banned_until in the future: ${isBanned ? '✅ PASS' : '❌ FAIL'}`);
      if (!isBanned) allPassed = false;

      const unbanReq = makeRequest(`http://localhost:3000/api/super-admin/users/${testUserId}`, {
        method: 'PATCH',
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL, 'Content-Type': 'application/json' },
        body: { action: 'unban' },
      });
      const unbanRes = await userPatch(unbanReq, { params: Promise.resolve({ id: testUserId }) } as any);
      const unbanJson = await unbanRes.json();
      const isUnbanned = unbanRes.status === 200 && (!unbanJson.bannedUntil || new Date(unbanJson.bannedUntil) <= new Date());
      console.log(`   - Unban clears banned_until: ${isUnbanned ? '✅ PASS' : '❌ FAIL'}`);
      if (!isUnbanned) allPassed = false;
    } catch (err) {
      console.error('   - Ban/unban test error:', err);
      allPassed = false;
    }

    // 3b. Admin Management Lifecycle: Create -> Edit -> List/Filter -> Delete
    console.log('\n3b. Testing Admin Management lifecycle (Create, Edit, Filter, Delete, Self-delete protection)...');
    let managedAdminUserId: string | null = null;
    const MANAGED_ADMIN_EMAIL = `super-admin-managed-${Date.now()}@aiwhisper.internal`;
    try {
      // A. Create new admin user
      const createReq = makeRequest('http://localhost:3000/api/super-admin/users', {
        method: 'POST',
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL, 'Content-Type': 'application/json' },
        body: {
          email: MANAGED_ADMIN_EMAIL,
          password: 'TemporaryAdminPassword123!',
          fullName: 'Managed Platform Admin',
          tenantId: TEST_TENANT_ID,
          role: 'admin',
        },
      });
      const createRes = await userCreate(createReq);
      const createJson = await createRes.json();
      const createdSuccess = createRes.status === 201 && !!createJson.id && createJson.email === MANAGED_ADMIN_EMAIL;
      console.log(`   - SuperAdmin creates new admin user: ${createdSuccess ? '✅ PASS' : '❌ FAIL'} (status ${createRes.status})`);
      if (!createdSuccess) allPassed = false;
      managedAdminUserId = createJson.id;

      // Verify membership
      const { data: memberRow } = await sb
        .from('tenant_members')
        .select('role')
        .eq('tenant_id', TEST_TENANT_ID)
        .eq('user_id', managedAdminUserId!)
        .maybeSingle();
      const memberCreated = memberRow?.role === 'admin';
      console.log(`   - New admin linked in tenant_members: ${memberCreated ? '✅ PASS' : '❌ FAIL'}`);
      if (!memberCreated) allPassed = false;

      // B. Update admin details (role, full_name, password)
      const updateReq = makeRequest(`http://localhost:3000/api/super-admin/users/${managedAdminUserId}`, {
        method: 'PATCH',
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL, 'Content-Type': 'application/json' },
        body: {
          action: 'update',
          fullName: 'Updated Admin Name',
          role: 'operator',
          password: 'NewUpdatedPassword456!',
        },
      });
      const updateRes = await userPatch(updateReq, { params: Promise.resolve({ id: managedAdminUserId! }) } as any);
      const updateJson = await updateRes.json();
      const updatedSuccess = updateRes.status === 200 && updateJson.fullName === 'Updated Admin Name' && updateJson.role === 'operator';
      console.log(`   - SuperAdmin updates admin details and resets password: ${updatedSuccess ? '✅ PASS' : '❌ FAIL'}`);
      if (!updatedSuccess) allPassed = false;

      // C. List users with search and role filter
      const listReq = makeRequest(`http://localhost:3000/api/super-admin/users?q=${encodeURIComponent(MANAGED_ADMIN_EMAIL)}`, {
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL },
      });
      const listRes = await usersListGet(listReq);
      const listJson = await listRes.json();
      const foundInList = listRes.status === 200 && listJson.users?.some((u: any) => u.id === managedAdminUserId);
      console.log(`   - Users list with search query finds the managed admin: ${foundInList ? '✅ PASS' : '❌ FAIL'}`);
      if (!foundInList) allPassed = false;

      // D. Prevent self-deletion
      const selfDeleteReq = makeRequest(`http://localhost:3000/api/super-admin/users/${TEST_ADMIN_USER_ID}`, {
        method: 'DELETE',
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL },
      });
      const selfDeleteRes = await userDelete(selfDeleteReq, { params: Promise.resolve({ id: TEST_ADMIN_USER_ID }) } as any);
      const selfDeleteProtected = selfDeleteRes.status === 400;
      console.log(`   - Self-deletion is guarded and rejected: ${selfDeleteProtected ? '✅ PASS' : '❌ FAIL'} (status ${selfDeleteRes.status})`);
      if (!selfDeleteProtected) allPassed = false;

      // E. Permanently delete the managed admin
      const deleteReq = makeRequest(`http://localhost:3000/api/super-admin/users/${managedAdminUserId}`, {
        method: 'DELETE',
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL },
      });
      const deleteRes = await userDelete(deleteReq, { params: Promise.resolve({ id: managedAdminUserId! }) } as any);
      const deleteSuccess = deleteRes.status === 200;
      console.log(`   - SuperAdmin permanently deletes admin user: ${deleteSuccess ? '✅ PASS' : '❌ FAIL'} (status ${deleteRes.status})`);
      if (!deleteSuccess) allPassed = false;

      // Verify deletion from auth, users, and tenant_members
      const { data: authGone } = await sb.auth.admin.getUserById(managedAdminUserId!);
      const { data: memberGone } = await sb.from('tenant_members').select('id').eq('user_id', managedAdminUserId!);
      const isCompletelyDeleted = !authGone?.user && (memberGone?.length || 0) === 0;
      console.log(`   - Admin removed completely across Auth and database: ${isCompletelyDeleted ? '✅ PASS' : '❌ FAIL'}`);
      if (!isCompletelyDeleted) allPassed = false;
      managedAdminUserId = null; // already deleted
    } catch (err) {
      console.error('   - Admin lifecycle test error:', err);
      allPassed = false;
    } finally {
      if (managedAdminUserId) {
        await sb.from('tenant_members').delete().eq('user_id', managedAdminUserId);
        await sb.auth.admin.deleteUser(managedAdminUserId).catch(() => {});
      }
    }

    // 3c. Account Expiry Timer & Auto-Disable Lifecycle
    console.log('\n3c. Testing Account Expiry Timer & Auto-Disable lifecycle (1-Month, Custom Date, Auto-Disable, Clear Expiry)...');
    let expiryUserId: string | null = null;
    const EXPIRY_TEST_EMAIL = `expiry_test_${Date.now()}@test.com`;

    try {
      // Create test user for expiry test
      const { data: createdExpUser, error: createExpErr } = await sb.auth.admin.createUser({
        email: EXPIRY_TEST_EMAIL,
        password: 'Password123!',
        email_confirm: true,
        user_metadata: { full_name: 'Expiry Test User' },
        app_metadata: { tenant_id: TEST_TENANT_ID, role: 'admin' },
      });
      if (createExpErr || !createdExpUser?.user) throw createExpErr || new Error('Failed to create expiry test user');
      expiryUserId = createdExpUser.user.id;

      // 1. Set 1-Month Expiry (+30 days)
      const oneMonthFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const set1MonthReq = makeRequest(`http://localhost:3000/api/super-admin/users/${expiryUserId}`, {
        method: 'PATCH',
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL, 'Content-Type': 'application/json' },
        body: {
          action: 'set_expiry',
          expiresAt: oneMonthFromNow,
        },
      });
      const set1MonthRes = await userPatch(set1MonthReq, { params: Promise.resolve({ id: expiryUserId }) } as any);
      const set1MonthJson = await set1MonthRes.json();
      const oneMonthSuccess = set1MonthRes.status === 200 && set1MonthJson.expiresAt === oneMonthFromNow && set1MonthJson.isExpired === false;
      console.log(`   - SuperAdmin sets 1-month expiry timer: ${oneMonthSuccess ? '✅ PASS' : '❌ FAIL'}`);
      if (!oneMonthSuccess) allPassed = false;

      // Verify in user listing GET
      const listReq = makeRequest(`http://localhost:3000/api/super-admin/users?q=${encodeURIComponent(EXPIRY_TEST_EMAIL)}`, {
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL },
      });
      const listRes = await usersListGet(listReq);
      const listJson = await listRes.json();
      const listedUser = listJson.users?.find((u: any) => u.id === expiryUserId);
      const listMatches = listedUser?.expiresAt === oneMonthFromNow && listedUser?.isExpired === false && listedUser?.isBanned === false;
      console.log(`   - Active expiry countdown reflected in user list: ${listMatches ? '✅ PASS' : '❌ FAIL'}`);
      if (!listMatches) allPassed = false;

      // 2. Set Past Expiry Date (Simulate timer expiration -> immediate auto-disable)
      const pastDate = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
      const setExpiredReq = makeRequest(`http://localhost:3000/api/super-admin/users/${expiryUserId}`, {
        method: 'PATCH',
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL, 'Content-Type': 'application/json' },
        body: {
          action: 'set_expiry',
          expiresAt: pastDate,
        },
      });
      const setExpiredRes = await userPatch(setExpiredReq, { params: Promise.resolve({ id: expiryUserId }) } as any);
      const setExpiredJson = await setExpiredRes.json();
      const expiredAutoDisabled = setExpiredRes.status === 200 && setExpiredJson.isExpired === true && setExpiredJson.isBanned === true;
      console.log(`   - Expired timer automatically disables account: ${expiredAutoDisabled ? '✅ PASS' : '❌ FAIL'}`);
      if (!expiredAutoDisabled) allPassed = false;

      // 3. Clear Expiry Date (Restore permanent lifetime access)
      const clearExpiryReq = makeRequest(`http://localhost:3000/api/super-admin/users/${expiryUserId}`, {
        method: 'PATCH',
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL, 'Content-Type': 'application/json' },
        body: {
          action: 'set_expiry',
          expiresAt: null,
        },
      });
      const clearExpiryRes = await userPatch(clearExpiryReq, { params: Promise.resolve({ id: expiryUserId }) } as any);
      const clearExpiryJson = await clearExpiryRes.json();
      const clearExpirySuccess = clearExpiryRes.status === 200 && clearExpiryJson.expiresAt === null && clearExpiryJson.isExpired === false;
      console.log(`   - Clearing expiry restores active permanent access: ${clearExpirySuccess ? '✅ PASS' : '❌ FAIL'}`);
      if (!clearExpirySuccess) allPassed = false;

      // Clean up
      await sb.auth.admin.deleteUser(expiryUserId).catch(() => {});
      expiryUserId = null;
    } catch (err) {
      console.error('   - Expiry lifecycle test error:', err);
      allPassed = false;
    } finally {
      if (expiryUserId) {
        await sb.auth.admin.deleteUser(expiryUserId).catch(() => {});
      }
    }

    // 4. Tenant suspend/reactivate via check_tenant_active RPC.
    console.log('\n4. Testing tenant suspend/reactivate + check_tenant_active RPC...');
    try {
      const suspendReq = makeRequest(`http://localhost:3000/api/super-admin/organizations/${TEST_TENANT_ID}`, {
        method: 'PATCH',
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL, 'Content-Type': 'application/json' },
        body: { action: 'suspend', reason: 'test suspension' },
      });
      await organizationPatch(suspendReq, { params: Promise.resolve({ id: TEST_TENANT_ID }) } as any);

      const { data: activeAfterSuspend } = await sb.rpc('check_tenant_active', { p_tenant_id: TEST_TENANT_ID });
      console.log(`   - check_tenant_active returns false after suspend: ${activeAfterSuspend === false ? '✅ PASS' : '❌ FAIL'}`);
      if (activeAfterSuspend !== false) allPassed = false;

      const reactivateReq = makeRequest(`http://localhost:3000/api/super-admin/organizations/${TEST_TENANT_ID}`, {
        method: 'PATCH',
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL, 'Content-Type': 'application/json' },
        body: { action: 'reactivate' },
      });
      await organizationPatch(reactivateReq, { params: Promise.resolve({ id: TEST_TENANT_ID }) } as any);

      const { data: activeAfterReactivate } = await sb.rpc('check_tenant_active', { p_tenant_id: TEST_TENANT_ID });
      console.log(`   - check_tenant_active returns true after reactivate: ${activeAfterReactivate === true ? '✅ PASS' : '❌ FAIL'}`);
      if (activeAfterReactivate !== true) allPassed = false;
    } catch (err) {
      console.error('   - Tenant suspension test error:', err);
      allPassed = false;
    }

    // 5. Every mutating action above must have produced a platform_audit_logs row.
    console.log('\n5. Testing platform_audit_logs captures mutating actions...');
    try {
      const { data: logs } = await sb
        .from('platform_audit_logs')
        .select('action')
        .eq('actor_email', TEST_ADMIN_EMAIL)
        .in('action', ['user.create', 'user.update', 'user.delete', 'user.ban', 'user.unban', 'organization.suspend', 'organization.reactivate']);

      const actions = new Set((logs || []).map((l) => l.action));
      const requiredActions = ['user.create', 'user.update', 'user.delete', 'user.ban', 'user.unban', 'organization.suspend', 'organization.reactivate'];
      const allLogged = requiredActions.every((a) => actions.has(a));
      console.log(`   - All ${requiredActions.length} mutating actions logged: ${allLogged ? '✅ PASS' : '❌ FAIL'} (found: ${Array.from(actions).join(', ')})`);
      if (!allLogged) allPassed = false;
    } catch (err) {
      console.error('   - Audit log verification error:', err);
      allPassed = false;
    }

    // 6. Impersonation start never touches the target's password and is logged.
    console.log('\n6. Testing impersonation start uses magic-link (no password) and logs the event...');
    try {
      if (!testUserId) throw new Error('Test user was not created');
      const impReq = makeRequest('http://localhost:3000/api/super-admin/impersonate', {
        method: 'POST',
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL, 'Content-Type': 'application/json' },
        body: { targetUserId: testUserId },
      });
      const impRes = await impersonateStart(impReq);
      const impJson = await impRes.json();
      const hasToken = impRes.status === 200 && !!impJson.hashedToken && !('password' in impJson);
      console.log(`   - Impersonation returns a hashed magic-link token, no password: ${hasToken ? '✅ PASS' : '❌ FAIL'}`);
      if (!hasToken) allPassed = false;

      const { data: impLogs } = await sb
        .from('platform_audit_logs')
        .select('id')
        .eq('actor_email', TEST_ADMIN_EMAIL)
        .eq('action', 'impersonate_start')
        .eq('target_id', testUserId);
      const logged = (impLogs?.length || 0) > 0;
      console.log(`   - impersonate_start audit-logged: ${logged ? '✅ PASS' : '❌ FAIL'}`);
      if (!logged) allPassed = false;
    } catch (err) {
      console.error('   - Impersonation test error:', err);
      allPassed = false;
    }

    // 7. ILIKE wildcard bypass: an email that only pattern-matches the seeded
    // admin's email via '_'/'%' as LIKE wildcards must NOT be granted access.
    console.log('\n7. Testing email comparison rejects LIKE-wildcard pattern matches...');
    try {
      await sb.from('platform_admins').upsert({ email: WILDCARD_ADMIN_EMAIL, platform_role: 'super_admin' }, { onConflict: 'email' });
      const guarded = withPlatformAdminAuth(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }) as any);

      // 'x' in place of each '_' would LIKE-match WILDCARD_ADMIN_EMAIL under unescaped ILIKE.
      const spoofEmail = WILDCARD_ADMIN_EMAIL.replace(/_/g, 'x');
      const spoofReq = makeRequest('http://localhost:3000/api/super-admin/overview', {
        headers: { 'x-user-id': 'spoof', 'x-user-email': spoofEmail },
      });
      const spoofRes = await guarded(spoofReq);
      const spoofRejected = spoofRes.status === 403;
      console.log(`   - Wildcard-spoofed email rejected: ${spoofRejected ? '✅ PASS' : '❌ FAIL'}`);
      if (!spoofRejected) allPassed = false;

      const realReq = makeRequest('http://localhost:3000/api/super-admin/overview', {
        headers: { 'x-user-id': 'real', 'x-user-email': WILDCARD_ADMIN_EMAIL },
      });
      const realRes = await guarded(realReq);
      const realAccepted = realRes.status === 200;
      console.log(`   - Genuine underscore-containing email still accepted: ${realAccepted ? '✅ PASS' : '❌ FAIL'}`);
      if (!realAccepted) allPassed = false;

      await sb.from('platform_admins').delete().eq('email', WILDCARD_ADMIN_EMAIL);
    } catch (err) {
      console.error('   - ILIKE bypass test error:', err);
      allPassed = false;
    }

    // 8. auditor role: read access on GET, rejected on mutating routes.
    console.log('\n8. Testing auditor platform role has read-only access...');
    try {
      await sb.from('platform_admins').upsert({ email: AUDITOR_EMAIL, platform_role: 'auditor' }, { onConflict: 'email' });

      const listReq = makeRequest('http://localhost:3000/api/super-admin/organizations', {
        headers: { 'x-user-id': 'auditor', 'x-user-email': AUDITOR_EMAIL },
      });
      const listRes = await organizationsListGet(listReq);
      console.log(`   - Auditor GET /organizations succeeds: ${listRes.status === 200 ? '✅ PASS' : '❌ FAIL'} (status ${listRes.status})`);
      if (listRes.status !== 200) allPassed = false;

      const patchReq = makeRequest(`http://localhost:3000/api/super-admin/organizations/${TEST_TENANT_ID}`, {
        method: 'PATCH',
        headers: { 'x-user-id': 'auditor', 'x-user-email': AUDITOR_EMAIL, 'Content-Type': 'application/json' },
        body: { action: 'suspend' },
      });
      const patchRes = await organizationPatch(patchReq, { params: Promise.resolve({ id: TEST_TENANT_ID }) });
      console.log(`   - Auditor PATCH /organizations/:id rejected: ${patchRes.status === 403 ? '✅ PASS' : '❌ FAIL'} (status ${patchRes.status})`);
      if (patchRes.status !== 403) allPassed = false;

      await sb.from('platform_admins').delete().eq('email', AUDITOR_EMAIL);
    } catch (err) {
      console.error('   - Auditor role test error:', err);
      allPassed = false;
    }

    // 9. /api/super-admin/me reports the caller's own resolved role.
    console.log('\n9. Testing /api/super-admin/me reports the correct role...');
    try {
      const meReq = makeRequest('http://localhost:3000/api/super-admin/me', {
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL },
      });
      const meRes = await meGet(meReq);
      const meJson = await meRes.json();
      const correctRole = meRes.status === 200 && meJson.platformRole === 'super_admin' && meJson.email === TEST_ADMIN_EMAIL;
      console.log(`   - /me reports super_admin for the seeded admin: ${correctRole ? '✅ PASS' : '❌ FAIL'}`);
      if (!correctRole) allPassed = false;
    } catch (err) {
      console.error('   - /me route test error:', err);
      allPassed = false;
    }

    // 10. Organization search doesn't break or leak data on PostgREST-special characters.
    console.log('\n10. Testing organization search is safe against filter-injection characters...');
    try {
      const injectionReq = makeRequest(`http://localhost:3000/api/super-admin/organizations?q=${encodeURIComponent('nomatch),is_active.eq.true,(id.neq')}`, {
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL },
      });
      const injectionRes = await organizationsListGet(injectionReq);
      const safe = injectionRes.status === 200;
      console.log(`   - Search with comma/parenthesis characters doesn't error: ${safe ? '✅ PASS' : '❌ FAIL'} (status ${injectionRes.status})`);
      if (!safe) allPassed = false;

      const normalReq = makeRequest(`http://localhost:3000/api/super-admin/organizations?q=${encodeURIComponent('Super Admin Test')}`, {
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL },
      });
      const normalRes = await organizationsListGet(normalReq);
      const normalJson = await normalRes.json();
      const foundTestTenant = Array.isArray(normalJson) && normalJson.some((o: any) => o.id === TEST_TENANT_ID);
      console.log(`   - Normal partial-name search still finds the test tenant: ${foundTestTenant ? '✅ PASS' : '❌ FAIL'}`);
      if (!foundTestTenant) allPassed = false;
    } catch (err) {
      console.error('   - Organization search safety test error:', err);
      allPassed = false;
    }
    // 11. Tenant hard-delete: wrong confirmation rejected, correct
    // confirmation cascades to members/channels, and the audit trail
    // survives even though the tenant row (and its FK) is gone.
    console.log('\n11. Testing tenant hard-delete (confirmation guard + cascade)...');
    const DELETE_TENANT_ID = '00000000-0000-0000-0000-0000000000c1';
    let deleteTestUserId: string | null = null;
    try {
      await sb.from('tenants').upsert({ id: DELETE_TENANT_ID, name: 'Delete Me Tenant', slug: 'delete-me-tenant', is_active: true });

      const { data: deleteTestUser } = await sb.auth.admin.createUser({
        email: `super-admin-delete-test-${Date.now()}@aiwhisper.internal`,
        password: 'Test-Password-123!',
        email_confirm: true,
      });
      deleteTestUserId = deleteTestUser?.user?.id || null;
      if (deleteTestUserId) {
        await sb.from('tenant_members').insert({ tenant_id: DELETE_TENANT_ID, user_id: deleteTestUserId, role: 'owner' });
      }
      await sb.from('channels').insert({ tenant_id: DELETE_TENANT_ID, type: 'whatsapp', display_name: 'Delete Test Channel', status: 'disconnected' });

      const wrongConfirmReq = makeRequest(`http://localhost:3000/api/super-admin/organizations/${DELETE_TENANT_ID}`, {
        method: 'DELETE',
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL, 'Content-Type': 'application/json' },
        body: { confirm: 'not-the-right-slug' },
      });
      const wrongConfirmRes = await organizationDelete(wrongConfirmReq, { params: Promise.resolve({ id: DELETE_TENANT_ID }) });
      const wrongRejected = wrongConfirmRes.status === 400;
      console.log(`   - Wrong confirmation text rejected: ${wrongRejected ? '✅ PASS' : '❌ FAIL'} (status ${wrongConfirmRes.status})`);
      if (!wrongRejected) allPassed = false;

      const { data: stillExists } = await sb.from('tenants').select('id').eq('id', DELETE_TENANT_ID).maybeSingle();
      console.log(`   - Tenant survives rejected delete: ${stillExists ? '✅ PASS' : '❌ FAIL'}`);
      if (!stillExists) allPassed = false;

      const correctConfirmReq = makeRequest(`http://localhost:3000/api/super-admin/organizations/${DELETE_TENANT_ID}`, {
        method: 'DELETE',
        headers: { 'x-user-id': TEST_ADMIN_USER_ID, 'x-user-email': TEST_ADMIN_EMAIL, 'Content-Type': 'application/json' },
        body: { confirm: 'delete-me-tenant' },
      });
      const correctConfirmRes = await organizationDelete(correctConfirmReq, { params: Promise.resolve({ id: DELETE_TENANT_ID }) });
      const deleted = correctConfirmRes.status === 200;
      console.log(`   - Correct confirmation deletes the tenant: ${deleted ? '✅ PASS' : '❌ FAIL'} (status ${correctConfirmRes.status})`);
      if (!deleted) allPassed = false;

      const { data: tenantGone } = await sb.from('tenants').select('id').eq('id', DELETE_TENANT_ID).maybeSingle();
      const { data: membersGone } = await sb.from('tenant_members').select('id').eq('tenant_id', DELETE_TENANT_ID);
      const { data: channelsGone } = await sb.from('channels').select('id').eq('tenant_id', DELETE_TENANT_ID);
      const cascaded = !tenantGone && (membersGone?.length || 0) === 0 && (channelsGone?.length || 0) === 0;
      console.log(`   - Cascade removed tenant_members and channels: ${cascaded ? '✅ PASS' : '❌ FAIL'}`);
      if (!cascaded) allPassed = false;

      const { data: deleteLogs } = await sb
        .from('platform_audit_logs')
        .select('id, tenant_id, metadata')
        .eq('actor_email', TEST_ADMIN_EMAIL)
        .eq('action', 'organization.delete')
        .eq('target_id', DELETE_TENANT_ID);
      const auditSurvives = (deleteLogs?.length || 0) > 0 && deleteLogs![0].tenant_id === null && deleteLogs![0].metadata?.slug === 'delete-me-tenant';
      console.log(`   - Audit entry survives with tenant_id nulled + slug in metadata: ${auditSurvives ? '✅ PASS' : '❌ FAIL'}`);
      if (!auditSurvives) allPassed = false;
    } catch (err) {
      console.error('   - Tenant delete test error:', err);
      allPassed = false;
    } finally {
      if (deleteTestUserId) await sb.auth.admin.deleteUser(deleteTestUserId).catch(() => {});
      await sb.from('tenants').delete().eq('id', DELETE_TENANT_ID);
    }
  } finally {
    // Cleanup
    try {
      if (testUserId) await sb.auth.admin.deleteUser(testUserId).catch(() => {});
      await sb.from('platform_audit_logs').delete().eq('actor_email', TEST_ADMIN_EMAIL);
      await sb.from('platform_admins').delete().eq('email', TEST_ADMIN_EMAIL);
      await sb.from('platform_admins').delete().eq('email', WILDCARD_ADMIN_EMAIL);
      await sb.from('platform_admins').delete().eq('email', AUDITOR_EMAIL);
      await sb.from('tenants').delete().eq('id', TEST_TENANT_ID);
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr);
    }
  }

  console.log('\n============================================================');
  console.log(`  FINAL RESULT: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('============================================================\n');

  return allPassed;
}

if (process.argv[1]?.includes('super_admin.test')) {
  runSuperAdminTestSuite().then(ok => process.exit(ok ? 0 : 1)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
