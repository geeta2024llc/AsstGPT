import 'dotenv/config';
import {
  getContactProfile,
  updateContactProfile,
  addContactTag,
  removeContactTag,
  getConversations,
  updateConversation,
} from '../../src/lib/db';

export async function runPhase3TestSuite(): Promise<boolean> {
  console.log('\n============================================================');
  console.log('  PHASE 3: CONTACT CRM & CUSTOMER PROFILE TEST SUITE');
  console.log('============================================================\n');

  let allPassed = true;
  const testChatId = 'test_crm_lead_12345@s.whatsapp.net';

  // Ensure conversation exists
  await updateConversation(testChatId, {
    name: 'Alexander Sterling',
    lastMessage: { text: 'Interested in enterprise plan', timestamp: Date.now() },
  });

  // Test 1: Create / Update Initial Contact CRM Profile
  console.log('1. Testing Contact Profile Initialization & Retrieval...');
  try {
    const profile = await updateContactProfile(testChatId, {
      name: 'Alexander Sterling',
      email: 'alex.sterling@globalenterprise.com',
      company: 'Global Enterprises Inc.',
      stage: 'prospect',
      tags: ['Enterprise', 'High Priority'],
      notes: 'Initial discovery call completed. Interested in 50 agent licenses with custom CRM integration.',
    });

    console.log(`   - Created CRM Contact ID: ${profile.id}`);
    console.log(`   - Name: "${profile.name}" | Company: "${profile.company}"`);
    console.log(`   - Stage: ${profile.stage} | Tags: [${profile.tags.join(', ')}]`);

    const stageMatch = profile.stage === 'prospect';
    const tagMatch = profile.tags.includes('Enterprise') && profile.tags.includes('High Priority');

    if (stageMatch && tagMatch) {
      console.log('   - Contact Profile Initialization: ✅ PASS');
    } else {
      console.log('   - Contact Profile Initialization: ❌ FAIL');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Contact initialization error:', err);
    allPassed = false;
  }

  // Test 2: Lifecycle Stage Transition (Prospect -> VIP)
  console.log('\n2. Testing Lifecycle Stage Transitions...');
  try {
    const vipProfile = await updateContactProfile(testChatId, {
      stage: 'vip',
      notes: 'Signed annual contract for Enterprise tier. Upgraded to VIP support status.',
    });

    console.log(`   - Transitioned Stage to: ${vipProfile.stage} (Notes: "${(vipProfile.notes || '').slice(0, 40)}...")`);
    if (vipProfile.stage === 'vip') {
      console.log('   - VIP Stage Transition: ✅ PASS');
    } else {
      console.log('   - VIP Stage Transition: ❌ FAIL');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Stage transition error:', err);
    allPassed = false;
  }

  // Test 3: Tag Management (Add Tag & Remove Tag)
  console.log('\n3. Testing Tag Additions & Removals...');
  try {
    // Add tag
    const tagsAfterAdd = await addContactTag(testChatId, 'Annual Contract');
    console.log(`   - Added tag "Annual Contract" -> Active Tags: [${tagsAfterAdd.join(', ')}]`);
    const addPass = tagsAfterAdd.includes('Annual Contract');

    // Remove tag
    const tagsAfterRemove = await removeContactTag(testChatId, 'High Priority');
    console.log(`   - Removed tag "High Priority" -> Active Tags: [${tagsAfterRemove.join(', ')}]`);
    const removePass = !tagsAfterRemove.includes('High Priority') && tagsAfterRemove.includes('Annual Contract');

    if (addPass && removePass) {
      console.log('   - Tag Management (Add/Remove): ✅ PASS');
    } else {
      console.log('   - Tag Management (Add/Remove): ❌ FAIL');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Tag management error:', err);
    allPassed = false;
  }

  // Test 4: Conversation List Join & CRM Hydration
  console.log('\n4. Testing Conversation List CRM Hydration...');
  try {
    const convos = await getConversations();
    const crmConvo = convos.find(c => c.id === testChatId);

    console.log(`   - Found conversation in list: ${crmConvo ? 'YES' : 'NO'}`);
    if (crmConvo) {
      console.log(`   - Hydrated Stage: ${crmConvo.stage} (Expected: "vip")`);
      console.log(`   - Hydrated Tags: [${crmConvo.tags?.join(', ') || ''}]`);
      console.log(`   - Hydrated Company: "${crmConvo.company}"`);

      const hydratePass =
        crmConvo.stage === 'vip' &&
        crmConvo.company === 'Global Enterprises Inc.' &&
        (crmConvo.tags || []).includes('Annual Contract');

      if (hydratePass) {
        console.log('   - Conversation List CRM Hydration: ✅ PASS');
      } else {
        console.log('   - Conversation List CRM Hydration: ❌ FAIL');
        allPassed = false;
      }
    } else {
      console.log('   - Conversation List CRM Hydration: ❌ FAIL (Convo not found)');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Hydration error:', err);
    allPassed = false;
  }

  console.log('\n============================================================');
  console.log(`  FINAL RESULT: ${allPassed ? '✅ ALL PHASE 3 TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('============================================================\n');

  return allPassed;
}

// Direct execution
if (require.main === module) {
  runPhase3TestSuite().then(passed => {
    process.exit(passed ? 0 : 1);
  });
}
