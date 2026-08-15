import 'dotenv/config';
import {
  getCannedResponses,
  createCannedResponse,
  updateCannedResponse,
  deleteCannedResponse,
  getConversations,
  resolveConversation,
  updateConversation,
} from '../../src/lib/db';

export async function runPhase1TestSuite(): Promise<boolean> {
  console.log('\n============================================================');
  console.log('  PHASE 1: INBOX PRODUCTIVITY & LIFECYCLE TEST SUITE');
  console.log('============================================================\n');

  let allPassed = true;

  // Test 1: Canned Responses Retrieval & Auto-Seeding
  console.log('1. Testing Canned Responses Database Operations...');
  const cannedList = await getCannedResponses();
  console.log(`   - Total active/seeded canned responses: ${cannedList.length}`);
  if (cannedList.length >= 4) {
    console.log('   - Canned Responses auto-seeding: ✅ PASS');
    console.log(`   - Sample shortcut: "/${cannedList[0].shortcut}" (${cannedList[0].title})`);
  } else {
    console.log('   - Canned Responses auto-seeding: ❌ FAIL');
    allPassed = false;
  }

  // Test 2: Canned Response CRUD Operations
  console.log('\n2. Testing Canned Response CRUD Operations...');
  try {
    const testSnippet = await createCannedResponse({
      title: 'Temporary Test Greeting',
      shortcut: '/test_hello_world', // Verify leading slash is auto-stripped
      content: 'Hello! This is a test snippet template.',
      category: 'testing',
    });
    console.log(`   - Created snippet ID: ${testSnippet.id} (shortcut: "/${testSnippet.shortcut}")`);
    if (testSnippet.shortcut === 'test_hello_world') {
      console.log('   - Slug normalization (slash removal): ✅ PASS');
    } else {
      console.log('   - Slug normalization: ❌ FAIL');
      allPassed = false;
    }

    await updateCannedResponse(testSnippet.id, {
      title: 'Updated Test Greeting',
      content: 'Hello! This is updated content.',
    });
    console.log('   - Updated snippet content: ✅ PASS');

    await deleteCannedResponse(testSnippet.id);
    console.log('   - Deleted temporary snippet: ✅ PASS');
  } catch (crudErr) {
    console.error('   - Canned Response CRUD error:', crudErr);
    allPassed = false;
  }

  // Test 3: Conversation Lifecycle (Open vs Resolved)
  console.log('\n3. Testing Conversation Lifecycle State Transitions...');
  const testChatId = 'test_lifecycle_customer@s.whatsapp.net';
  try {
    // 3a: Ensure conversation exists
    await updateConversation(testChatId, {
      name: 'Lifecycle Test Customer',
      lastMessage: { text: 'Inquiry about order', timestamp: Date.now() },
      status: 'open',
    });

    let convos = await getConversations();
    let currentConvo = convos.find(c => c.id === testChatId);
    console.log(`   - Initial conversation status: ${currentConvo?.status} [${currentConvo?.status === 'open' ? '✅ PASS' : '❌ FAIL'}]`);
    if (currentConvo?.status !== 'open') allPassed = false;

    // 3b: Resolve conversation
    await resolveConversation(testChatId, true);
    convos = await getConversations();
    currentConvo = convos.find(c => c.id === testChatId);
    console.log(`   - Resolved conversation status: ${currentConvo?.status} [${currentConvo?.status === 'resolved' ? '✅ PASS' : '❌ FAIL'}]`);
    if (currentConvo?.status !== 'resolved') allPassed = false;

    // 3c: Reopen conversation
    await resolveConversation(testChatId, false);
    convos = await getConversations();
    currentConvo = convos.find(c => c.id === testChatId);
    console.log(`   - Reopened conversation status: ${currentConvo?.status} [${currentConvo?.status === 'open' ? '✅ PASS' : '❌ FAIL'}]`);
    if (currentConvo?.status !== 'open') allPassed = false;

    // Cleanup test conversation & contact
    const sb = (await import('../../src/lib/supabase')).getSupabaseAdmin();
    const { data: cc } = await sb.from('contact_channels').select('contact_id').eq('external_id', testChatId).maybeSingle();
    if (cc?.contact_id) {
      await sb.from('contacts').delete().eq('id', cc.contact_id);
    }
  } catch (lifeErr) {
    console.error('   - Lifecycle transition error:', lifeErr);
    allPassed = false;
  }

  console.log('\n============================================================');
  console.log(`  FINAL RESULT: ${allPassed ? '✅ ALL PHASE 1 TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('============================================================\n');

  return allPassed;
}

// Direct execution
if (require.main === module) {
  runPhase1TestSuite().then(passed => {
    process.exit(passed ? 0 : 1);
  });
}
