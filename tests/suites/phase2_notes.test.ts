import 'dotenv/config';
import {
  getConversationNotes,
  createConversationNote,
  deleteConversationNote,
} from '../../src/lib/db';

export async function runPhase2TestSuite(): Promise<boolean> {
  console.log('\n============================================================');
  console.log('  PHASE 2: REAL-TIME & INTERNAL TEAM NOTES TEST SUITE');
  console.log('============================================================\n');

  let allPassed = true;

  const testChatA = 'test_notes_customer_a@s.whatsapp.net';
  const testChatB = 'test_notes_customer_b@s.whatsapp.net';

  // Test 1: Create Internal Notes
  console.log('1. Testing Internal Team Note Creation...');
  let createdNoteA1Id = '';
  let createdNoteA2Id = '';
  let createdNoteB1Id = '';

  try {
    const noteA1 = await createConversationNote({
      chatId: testChatA,
      content: 'Customer is requesting an upgrade to the Enterprise plan.',
      userName: 'Sarah Jenkins',
      userId: 'user_agent_sarah',
    });
    createdNoteA1Id = noteA1.id;
    console.log(`   - Created Note 1 on Chat A: ID=${noteA1.id} by "${noteA1.userName}" [✅ PASS]`);

    const noteA2 = await createConversationNote({
      chatId: testChatA,
      content: 'Approved 15% discount for annual contract.',
      userName: 'David Miller',
      userId: 'user_agent_david',
    });
    createdNoteA2Id = noteA2.id;
    console.log(`   - Created Note 2 on Chat A: ID=${noteA2.id} by "${noteA2.userName}" [✅ PASS]`);

    const noteB1 = await createConversationNote({
      chatId: testChatB,
      content: 'Account flagged for billing verification.',
      userName: 'Admin Support',
    });
    createdNoteB1Id = noteB1.id;
    console.log(`   - Created Note 1 on Chat B: ID=${noteB1.id} [✅ PASS]`);
  } catch (err) {
    console.error('   - Note creation error:', err);
    allPassed = false;
  }

  // Test 2: Chat-Level Note Retrieval & Boundary Isolation
  console.log('\n2. Testing Chat Isolation & Retrieval...');
  try {
    const notesA = await getConversationNotes(testChatA);
    const notesB = await getConversationNotes(testChatB);

    console.log(`   - Chat A notes retrieved: ${notesA.length} (Expected >= 2)`);
    console.log(`   - Chat B notes retrieved: ${notesB.length} (Expected >= 1)`);

    const isolationPass =
      notesA.every(n => n.chatId === testChatA) &&
      notesB.every(n => n.chatId === testChatB) &&
      notesA.some(n => n.id === createdNoteA1Id) &&
      !notesB.some(n => n.id === createdNoteA1Id);

    if (isolationPass) {
      console.log('   - Chat boundary isolation: ✅ PASS (Notes strictly scoped to conversation)');
    } else {
      console.log('   - Chat boundary isolation: ❌ FAIL');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Note retrieval error:', err);
    allPassed = false;
  }

  // Test 3: Delete Note Operation
  console.log('\n3. Testing Note Deletion...');
  try {
    if (createdNoteA1Id) {
      await deleteConversationNote(createdNoteA1Id);
      const notesAfter = await getConversationNotes(testChatA);
      const deletedFound = notesAfter.some(n => n.id === createdNoteA1Id);

      if (!deletedFound) {
        console.log(`   - Note ${createdNoteA1Id} successfully deleted: ✅ PASS`);
      } else {
        console.log(`   - Note deletion check failed: ❌ FAIL`);
        allPassed = false;
      }
    }

    // Cleanup remaining test notes
    if (createdNoteA2Id) await deleteConversationNote(createdNoteA2Id);
    if (createdNoteB1Id) await deleteConversationNote(createdNoteB1Id);
    console.log('   - Cleaned up test notes: ✅ PASS');
  } catch (err) {
    console.error('   - Note deletion error:', err);
    allPassed = false;
  }

  console.log('\n============================================================');
  console.log(`  FINAL RESULT: ${allPassed ? '✅ ALL PHASE 2 TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('============================================================\n');

  return allPassed;
}

// Direct execution
if (require.main === module) {
  runPhase2TestSuite().then(passed => {
    process.exit(passed ? 0 : 1);
  });
}
