import 'dotenv/config';
import {
  getTeamMembers,
  getTeamMember,
  updateTeamMember,
  deleteTeamMember,
  updateConversation,
  getConversation,
} from '../../src/lib/db';
import { getSupabaseAdmin } from '../../src/lib/supabase';
import { runWithRequestContext } from '../../src/lib/request-context';

// A dedicated, disposable tenant -- not DEFAULT_TENANT_ID -- so the
// last-admin-guard assertions are deterministic regardless of how much
// unrelated data has accumulated in the shared dev tenant.
const TEST_TENANT_ID = '00000000-0000-0000-0000-0000000000d7';

export async function runPhase7TestSuite(): Promise<boolean> {
  console.log('\n============================================================');
  console.log('  PHASE C: MULTI-USER TEAM ROLES & RBAC TEST SUITE');
  console.log('  (tenant_members is the single source of truth -- a "team');
  console.log('   member" only exists once a real account has joined the tenant)');
  console.log('============================================================\n');

  let allPassed = true;
  const sb = getSupabaseAdmin();
  let ownerUserId: string | null = null;
  let testUserId: string | null = null;
  let deleteTestUserId: string | null = null;
  const testChatId = 'test_rbac_chat_9988@s.whatsapp.net';

  const withTenantCtx = <T>(fn: () => Promise<T>) =>
    runWithRequestContext({ tenantId: TEST_TENANT_ID }, fn);

  try {
    console.log('0. Seeding a dedicated test tenant with an owner + admin member...');
    await sb.from('tenants').upsert({ id: TEST_TENANT_ID, name: 'Phase7 RBAC Test Tenant', slug: 'phase7-rbac-test-tenant', is_active: true });

    const { data: ownerCreated, error: ownerErr } = await sb.auth.admin.createUser({
      email: `phase7-rbac-owner-${Date.now()}@aiwhisper.internal`,
      password: 'Test-Password-123!',
      email_confirm: true,
      user_metadata: { full_name: 'Workspace Owner' },
    });
    if (ownerErr || !ownerCreated?.user) throw ownerErr || new Error('Failed to create owner test user');
    ownerUserId = ownerCreated.user.id;
    await sb.from('tenant_members').insert({ tenant_id: TEST_TENANT_ID, user_id: ownerUserId, role: 'owner' });

    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email: `phase7-rbac-test-${Date.now()}@aiwhisper.internal`,
      password: 'Test-Password-123!',
      email_confirm: true,
      user_metadata: { full_name: 'Marcus Aurelius' },
    });
    if (createErr || !created?.user) {
      throw createErr || new Error('Failed to create test auth user');
    }
    testUserId = created.user.id;

    const { error: memberErr } = await sb.from('tenant_members').insert({
      tenant_id: TEST_TENANT_ID,
      user_id: testUserId,
      role: 'admin',
      status: 'online',
      assigned_queues: ['billing', 'vip', 'executive'],
    });
    if (memberErr) throw memberErr;
    console.log(`   - Seeded tenant_members rows: owner ${ownerUserId}, admin ${testUserId}`);

    // Test 1: tenant_members + public.users join surfaces the member correctly.
    console.log('\n1. Testing Team Member Listing (tenant_members join public.users)...');
    const members = await withTenantCtx(() => getTeamMembers());
    const found = members.find(m => m.id === testUserId);
    const hasCreated = found?.role === 'admin' && found?.assignedQueues?.includes('vip') && found?.fullName === 'Marcus Aurelius';
    console.log(`   - Found "${found?.fullName}" (ID: ${found?.id}, Role: ${found?.role})`);
    if (hasCreated) {
      console.log('   - Team Member Listing & Role: ✅ PASS');
    } else {
      console.log('   - Team Member Listing & Role: ❌ FAIL');
      allPassed = false;
    }

    // Test 2: Updating role with last-admin guard, availability status, and queues.
    // Marcus is the ONLY non-owner admin in this dedicated tenant, so this
    // deterministically exercises the atomic last-admin guard.
    console.log('\n2. Testing Updating Role, Status & Queues (with Last-Admin Confirmation)...');
    let lastAdminBlocked = false;
    try {
      await withTenantCtx(() => updateTeamMember(testUserId!, { role: 'operator' }));
    } catch (err: any) {
      if (err.message?.includes('CONFIRMATION_REQUIRED_LAST_ADMIN')) {
        lastAdminBlocked = true;
      }
    }
    console.log(`   - Last admin demotion without confirmation blocked: ${lastAdminBlocked ? '✅ PASS' : '❌ FAIL'}`);
    if (!lastAdminBlocked) allPassed = false;

    // Now update with confirmation
    await withTenantCtx(() =>
      updateTeamMember(
        testUserId!,
        { role: 'operator', status: 'away', assignedQueues: ['support', 'escalations'] },
        { confirmLastAdmin: true }
      )
    );

    const updated = await withTenantCtx(() => getTeamMember(testUserId!));
    console.log(`   - Updated Role: ${updated?.role} (Expected: "operator")`);
    console.log(`   - Updated Status: ${updated?.status} (Expected: "away")`);
    console.log(`   - Updated Queues: [${updated?.assignedQueues?.join(', ')}]`);

    const hasUpdated = updated?.role === 'operator' && updated?.status === 'away';
    if (hasUpdated) {
      console.log('   - Team Member Update & Status Change: ✅ PASS');
    } else {
      console.log('   - Team Member Update: ❌ FAIL');
      allPassed = false;
    }

    // Test 3: An owner's role cannot be changed through this action.
    console.log("\n3. Testing owner role is protected from this update path...");
    let ownerBlocked = false;
    try {
      await withTenantCtx(() => updateTeamMember(ownerUserId!, { role: 'viewer' }));
    } catch {
      ownerBlocked = true;
    }
    console.log(`   - Owner role change blocked: ${ownerBlocked ? '✅ PASS' : '❌ FAIL'}`);
    if (!ownerBlocked) allPassed = false;

    // Test 4: Assigning a conversation to a team member.
    console.log('\n4. Testing Conversation Assignment to Team Member...');
    await withTenantCtx(() =>
      updateConversation(testChatId, { name: 'Client Pro Inquiries', assignedUserId: testUserId! })
    );

    const convo = await withTenantCtx(() => getConversation(testChatId));
    console.log(`   - Conversation Assigned Agent ID: ${convo?.assignedUserId} (Matches: ${convo?.assignedUserId === testUserId})`);

    if (convo?.assignedUserId === testUserId) {
      console.log('   - Conversation Agent Assignment: ✅ PASS');
    } else {
      console.log('   - Conversation Agent Assignment: ❌ FAIL');
      allPassed = false;
    }

    // Test 5: Removing membership revokes access (tenant_members row gone),
    // and the last-admin guard also applies to removal. Marcus was demoted
    // to operator in Test 2, so this needs its own fresh admin to be the
    // tenant's only non-owner admin again.
    console.log('\n5. Testing Member Removal (with Last-Admin Confirmation)...');
    const { data: deleteTestCreated, error: deleteTestErr } = await sb.auth.admin.createUser({
      email: `phase7-rbac-delete-test-${Date.now()}@aiwhisper.internal`,
      password: 'Test-Password-123!',
      email_confirm: true,
      user_metadata: { full_name: 'Delete Test Admin' },
    });
    if (deleteTestErr || !deleteTestCreated?.user) throw deleteTestErr || new Error('Failed to create delete-test user');
    deleteTestUserId = deleteTestCreated.user.id;
    await sb.from('tenant_members').insert({ tenant_id: TEST_TENANT_ID, user_id: deleteTestUserId, role: 'admin' });

    let deleteBlocked = false;
    try {
      await withTenantCtx(() => deleteTeamMember(deleteTestUserId!));
    } catch (err: any) {
      if (err.message?.includes('CONFIRMATION_REQUIRED_LAST_ADMIN')) deleteBlocked = true;
    }
    console.log(`   - Last admin removal without confirmation blocked: ${deleteBlocked ? '✅ PASS' : '❌ FAIL'}`);
    if (!deleteBlocked) allPassed = false;

    await withTenantCtx(() => deleteTeamMember(deleteTestUserId!, { confirmLastAdmin: true }));
    const afterDelete = await withTenantCtx(() => getTeamMember(deleteTestUserId!));
    console.log(`   - Member Exists After Removal: ${afterDelete ? 'YES' : 'NO'}`);

    if (!afterDelete) {
      console.log('   - Team Member Removal: ✅ PASS');
    } else {
      console.log('   - Team Member Removal: ❌ FAIL');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Test error:', err);
    allPassed = false;
  } finally {
    // Cleanup: delete the test auth users (cascades their tenant_members
    // rows), the dedicated test tenant, and the test conversation/contact.
    if (testUserId) await sb.auth.admin.deleteUser(testUserId).catch(() => {});
    if (ownerUserId) await sb.auth.admin.deleteUser(ownerUserId).catch(() => {});
    if (deleteTestUserId) await sb.auth.admin.deleteUser(deleteTestUserId).catch(() => {});
    await sb.from('tenants').delete().eq('id', TEST_TENANT_ID);
    const { data: cc } = await sb.from('contact_channels').select('contact_id').eq('external_id', testChatId).maybeSingle();
    if (cc?.contact_id) {
      await sb.from('contacts').delete().eq('id', cc.contact_id);
    }
  }

  console.log('\n============================================================');
  console.log(`  FINAL RESULT: ${allPassed ? '✅ ALL PHASE C TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('============================================================\n');

  return allPassed;
}

// Direct execution
if (require.main === module) {
  runPhase7TestSuite().then(passed => {
    process.exit(passed ? 0 : 1);
  });
}
