import 'dotenv/config';
import {
  getTeamMembers,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
  getTeamMember,
  updateConversation,
  getConversation,
} from '../../src/lib/db';
import type { TeamMember } from '../../src/types';

export async function runPhase7TestSuite(): Promise<boolean> {
  console.log('\n============================================================');
  console.log('  PHASE C: MULTI-USER TEAM ROLES & RBAC TEST SUITE');
  console.log('============================================================\n');

  let allPassed = true;
  let testMemberId = '';

  // Test 1: Team Members CRUD with RBAC Roles
  console.log('1. Testing Team Member Creation with Role (Admin / Agent / Viewer)...');
  try {
    const created = await createTeamMember({
      fullName: 'Marcus Aurelius',
      email: 'marcus@stoicempire.com',
      avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100',
      role: 'admin',
      status: 'online',
      assignedQueues: ['billing', 'vip', 'executive'],
    });

    testMemberId = created.id;
    console.log(`   - Created Member: "${created.fullName}" (ID: ${created.id}, Role: ${created.role})`);

    const hasCreated = created.role === 'admin' && created.assignedQueues?.includes('vip');
    if (hasCreated) {
      console.log('   - Team Member Creation & Role Assignment: ✅ PASS');
    } else {
      console.log('   - Team Member Creation & Role Assignment: ❌ FAIL');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Creation error:', err);
    allPassed = false;
  }

  // Test 2: Updating Role & Availability Status
  console.log('\n2. Testing Updating Role, Status & Queues...');
  try {
    await updateTeamMember(testMemberId, {
      role: 'agent',
      status: 'away',
      assignedQueues: ['support', 'escalations'],
    });

    const updated = await getTeamMember(testMemberId);
    console.log(`   - Updated Role: ${updated?.role} (Expected: "agent")`);
    console.log(`   - Updated Status: ${updated?.status} (Expected: "away")`);
    console.log(`   - Updated Queues: [${updated?.assignedQueues?.join(', ')}]`);

    const hasUpdated = updated?.role === 'agent' && updated?.status === 'away';
    if (hasUpdated) {
      console.log('   - Team Member Update & Status Change: ✅ PASS');
    } else {
      console.log('   - Team Member Update: ❌ FAIL');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Update error:', err);
    allPassed = false;
  }

  // Test 3: Assigning Conversation to Team Member
  console.log('\n3. Testing Conversation Assignment to Team Member...');
  try {
    const testChatId = 'test_rbac_chat_9988@s.whatsapp.net';
    await updateConversation(testChatId, {
      name: 'Client Pro Inquiries',
      assignedUserId: testMemberId,
    });

    const convo = await getConversation(testChatId);
    console.log(`   - Conversation Assigned Agent ID: ${convo?.assignedUserId} (Matches: ${convo?.assignedUserId === testMemberId})`);

    if (convo?.assignedUserId === testMemberId) {
      console.log('   - Conversation Agent Assignment: ✅ PASS');
    } else {
      console.log('   - Conversation Agent Assignment: ❌ FAIL');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Assignment error:', err);
    allPassed = false;
  }

  // Test 4: Member Deletion Cleanup
  console.log('\n4. Testing Member Deletion Cleanup...');
  try {
    await deleteTeamMember(testMemberId);
    const afterDelete = await getTeamMember(testMemberId);
    console.log(`   - Member Exists After Delete: ${afterDelete ? 'YES' : 'NO'}`);

    if (!afterDelete) {
      console.log('   - Team Member Deletion: ✅ PASS');
    } else {
      console.log('   - Team Member Deletion: ❌ FAIL');
      allPassed = false;
    }

    // Cleanup test conversation & contact
    const sb = (await import('../../src/lib/supabase')).getSupabaseAdmin();
    const { data: cc } = await sb.from('contact_channels').select('contact_id').eq('external_id', 'test_rbac_chat_9988@s.whatsapp.net').maybeSingle();
    if (cc?.contact_id) {
      await sb.from('contacts').delete().eq('id', cc.contact_id);
    }
  } catch (err) {
    console.error('   - Deletion error:', err);
    allPassed = false;
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
