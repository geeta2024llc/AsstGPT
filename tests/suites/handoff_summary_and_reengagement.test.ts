import 'dotenv/config';
import { generateTakeoverCatchUpSummary } from '../../src/lib/handoff-engine';
import {
  getReEngagementConfig,
  updateReEngagementConfig,
  getConversationNotes,
  addMessage,
  getMessages,
  getConversation,
} from '../../src/lib/db';
import { processProactiveReEngagements } from '../../src/lib/re-engagement-engine';

export async function runHandoffSummaryAndReEngagementTests(): Promise<boolean> {
  console.log('\n============================================================');
  console.log('  HAND-OFF CATCH-UP SUMMARY & RE-ENGAGEMENT TEST SUITE');
  console.log('============================================================\n');

  try {
    // -------------------------------------------------------------
    // Test 1: Hand-Off Catch-Up Summary Generation
    // -------------------------------------------------------------
    console.log('1. Testing Hand-Off Catch-Up Summary Generation...');
    const testChatId = `test_briefing_${Date.now()}@s.whatsapp.net`;

    // Seed conversation with customer complaints and bot responses
    await addMessage({
      id: `msg_cust_1_${Date.now()}`,
      chatId: testChatId,
      fromMe: false,
      text: 'My order #4891 arrived completely broken and damaged. I need a refund immediately or I will contact my bank!',
      timestamp: Date.now() - 60000,
    });
    await addMessage({
      id: `msg_bot_1_${Date.now()}`,
      chatId: testChatId,
      fromMe: true,
      text: 'I apologize for the damaged item! Please let me know your tracking number.',
      timestamp: Date.now() - 30000,
    });
    await addMessage({
      id: `msg_cust_2_${Date.now()}`,
      chatId: testChatId,
      fromMe: false,
      text: 'Tracking number is TRK-99021. Put me through to a real supervisor now!',
      timestamp: Date.now() - 10000,
    });

    const summary = await generateTakeoverCatchUpSummary(
      testChatId,
      'Customer escalated damaged order with high urgency'
    );

    console.log('   - Customer Intent:', summary.customerIntent);
    console.log('   - Frustration Level:', summary.customerFrustration);
    console.log('   - Key Issue:', summary.keyIssue);
    console.log('   - Bot Attempted:', summary.botAttemptsSummary);
    console.log('   - Recommended Action:', summary.recommendedNextAction);

    if (!summary.keyIssue || !summary.recommendedNextAction) {
      console.error('❌ Catch-up summary missing key fields');
      return false;
    }
    console.log('   - Catch-Up Briefing Generation: ✅ PASS\n');

    // -------------------------------------------------------------
    // Test 2: Timeline Internal Note Insertion
    // -------------------------------------------------------------
    console.log('2. Testing Timeline Internal Note Creation for Agent Briefing...');
    const notes = await getConversationNotes(testChatId);
    const briefingNote = notes.find(n => n.userName.includes('Catch-Up Briefing') || n.content.includes('[AI Catch-Up Briefing]'));

    if (!briefingNote) {
      console.error('❌ Briefing note was not posted to conversation timeline notes');
      return false;
    }
    console.log(`   - Found briefing note by "${briefingNote.userName}": "${briefingNote.content.slice(0, 50)}..."`);
    console.log('   - Timeline Briefing Note: ✅ PASS\n');

    // -------------------------------------------------------------
    // Test 3: Re-Engagement Configuration Management
    // -------------------------------------------------------------
    console.log('3. Testing Re-Engagement Configuration Updates & Persistence...');
    const updatedConfig = await updateReEngagementConfig({
      isEnabled: true,
      inactivityHoursThreshold: 2,
      maxFollowUpsPerConversation: 2,
      followUpMessageTemplate: 'Hi {{name}}, just checking in on your order inquiry #4891?',
      aiGeneratedContextual: false,
    });

    const fetchedConfig = await getReEngagementConfig();
    console.log(`   - Config Persisted: isEnabled=${fetchedConfig.isEnabled}, threshold=${fetchedConfig.inactivityHoursThreshold}h`);

    if (
      !fetchedConfig.isEnabled ||
      fetchedConfig.inactivityHoursThreshold !== 2 ||
      fetchedConfig.maxFollowUpsPerConversation !== 2
    ) {
      console.error('❌ Re-engagement config did not persist correctly');
      return false;
    }
    console.log('   - Configuration Persistence: ✅ PASS\n');

    // -------------------------------------------------------------
    // Test 4: Stale Conversation Detection & Proactive Follow-Up Dispatch
    // -------------------------------------------------------------
    console.log('4. Testing Stale Conversation Detection & Follow-Up Dispatch...');
    const staleChatId = `test_stale_${Date.now()}@webchat`;

    // Seed a message 5 hours ago (threshold is 2 hours)
    await addMessage({
      id: `msg_stale_${Date.now()}`,
      chatId: staleChatId,
      fromMe: false,
      text: 'Could you give me more details on your pricing packages?',
      timestamp: Date.now() - (5 * 60 * 60 * 1000),
    });

    const result = await processProactiveReEngagements(true);
    console.log(`   - Scan Result: ${result.scanned} evaluated, ${result.dispatched} dispatched`);

    const staleMessages = await getMessages(staleChatId);
    const followUpMsg = staleMessages.find(m => m.fromMe && m.senderName?.includes('Follow-Up'));

    if (!followUpMsg) {
      console.error('❌ Follow-up message was not added to the conversation thread');
      return false;
    }

    console.log(`   - Dispatched Follow-Up Text: "${followUpMsg.text}"`);
    console.log('   - Follow-Up Message Dispatch: ✅ PASS\n');

    // -------------------------------------------------------------
    // Test 5: Re-Engagement Master Off Switch Enforcement
    // -------------------------------------------------------------
    console.log('5. Testing Master Switch (Disabled Mode) Safety...');
    await updateReEngagementConfig({ isEnabled: false });

    const disabledRunResult = await processProactiveReEngagements(false);
    console.log(`   - Disabled Run: dispatched=${disabledRunResult.dispatched}, isEnabled=${disabledRunResult.isEnabled}`);

    if (disabledRunResult.dispatched !== 0 || disabledRunResult.isEnabled !== false) {
      console.error('❌ Follow-up was dispatched when automation was toggled OFF');
      return false;
    }
    console.log('   - Master Off Switch Safety: ✅ PASS\n');

    console.log('============================================================');
    console.log('  FINAL RESULT: 🎉 ALL CATCH-UP & RE-ENGAGEMENT TESTS PASSED');
    console.log('============================================================\n');
    return true;
  } catch (err) {
    console.error('💥 Test suite encountered fatal error:', err);
    return false;
  }
}

if (
  process.argv[1]?.includes('handoff_summary_and_reengagement.test.ts') ||
  process.argv[1]?.includes('handoff_summary_and_reengagement.test')
) {
  runHandoffSummaryAndReEngagementTests().then(ok => {
    process.exit(ok ? 0 : 1);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
