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

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

export async function runPhase7TestSuite(): Promise<boolean> {
  console.log('\n============================================================');
  console.log('  PHASE C: MULTI-USER TEAM ROLES & RBAC TEST SUITE');
  console.log('  (tenant_members is the single source of truth -- a "team');
  console.log('   member" only exists once a real account has joined the tenant)');
  console.log('============================================================\n');

  let allPassed = true;
  const sb = getSupabaseAdmin();
  let testUserId: string | null = null;
  const testChatId = 'test_rbac_chat_9988@s.whatsapp.net';

  try {
    // Setup: a real auth user + tenant_members row, mirroring what
    // /api/invite/[token]/accept does for a genuinely invited member.
    console.log('0. Seeding a real tenant member via Supabase Auth admin API...');
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
      tenant_id: DEFAULT_TENANT_ID,
      user_id: testUserId,
      role: 'admin',
      status: 'online',
      assigned_queues: ['billing', 'vip', 'executive'],
    });
    if (memberErr) throw memberErr;
    console.log(`   - Seeded tenant_members row for user ${testUserId}`);

    // Test 1: tenant_members + public.users join surfaces the member correctly.
    console.log('\n1. Testing Team Member Listing (tenant_members join public.users)...');
    const members = await getTeamMembers();
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
    console.log('\n2. Testing Updating Role, Status & Queues (with Last-Admin Confirmation)...');
    let lastAdminBlocked = false;
    try {
      // Should be blocked without confirmLastAdmin
      await updateTeamMember(testUserId, {
        role: 'operator',
      });
    } catch (err: any) {
      if (err.message?.includes('CONFIRMATION_REQUIRED_LAST_ADMIN')) {
        lastAdminBlocked = true;
      }
    }
    console.log(`   - Last admin demotion without confirmation blocked: ${lastAdminBlocked ? '✅ PASS' : '❌ FAIL'}`);
    if (!lastAdminBlocked) allPassed = false;

    // Now update with confirmation
    await updateTeamMember(
      testUserId,
      {
        role: 'operator',
        status: 'away',
        assignedQueues: ['support', 'escalations'],
      },
      { confirmLastAdmin: true }
    );

    const updated = await getTeamMember(testUserId);
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
    const { data: ownerRow } = await sb
      .from('tenant_members')
      .select('user_id')
      .eq('tenant_id', DEFAULT_TENANT_ID)
      .eq('role', 'owner')
      .maybeSingle();
    if (ownerRow?.user_id) {
      let blocked = false;
      try {
        await updateTeamMember(ownerRow.user_id, { role: 'viewer' });
      } catch {
        blocked = true;
      }
      console.log(`   - Owner role change blocked: ${blocked ? '✅ PASS' : '❌ FAIL'}`);
      if (!blocked) allPassed = false;
    } else {
      console.log('   - No seeded owner for this tenant -- skipping (not a failure)');
    }

    // Test 4: Assigning a conversation to a team member.
    console.log('\n4. Testing Conversation Assignment to Team Member...');
    await updateConversation(testChatId, {
      name: 'Client Pro Inquiries',
      assignedUserId: testUserId,
    });

    const convo = await getConversation(testChatId);
    console.log(`   - Conversation Assigned Agent ID: ${convo?.assignedUserId} (Matches: ${convo?.assignedUserId === testUserId})`);

    if (convo?.assignedUserId === testUserId) {
      console.log('   - Conversation Agent Assignment: ✅ PASS');
    } else {
      console.log('   - Conversation Agent Assignment: ❌ FAIL');
      allPassed = false;
    }

    // Test 5: Removing membership revokes access (tenant_members row gone).
    console.log('\n5. Testing Member Removal...');
    await deleteTeamMember(testUserId, { confirmLastAdmin: true });
    const afterDelete = await getTeamMember(testUserId);
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
    // Cleanup: delete the test auth user (cascades tenant_members/public.users)
    // and the test conversation/contact.
    if (testUserId) {
      await sb.auth.admin.deleteUser(testUserId).catch(() => {});
    }
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
