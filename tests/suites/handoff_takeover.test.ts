import 'dotenv/config';
import {
  getHandoffRules,
  createHandoffRule,
  updateHandoffRule,
  deleteHandoffRule,
  getTeamMembers,
  getConversations,
  setConversationTakeover,
  updateConversation,
} from '../../src/lib/db';
import {
  evaluateHandoffRules,
  classifyIntent,
  calculateAIConfidence,
} from '../../src/lib/handoff-engine';

export async function runHandoffTestSuite(): Promise<boolean> {
  console.log('\n============================================================');
  console.log('  HUMAN AGENT HANDOFF & LIVE TAKEOVER TEST SUITE');
  console.log('============================================================\n');

  let allPassed = true;

  // Test 1: Team Members Fetching
  console.log('1. Testing Team Member Directory...');
  const team = await getTeamMembers();
  console.log(`   - Team members found: ${team.length}`);
  if (team.length > 0) {
    console.log(`   - Default team member: ${team[0].fullName} (${team[0].role})`);
    console.log('   - Team Member Directory: ✅ PASS');
  } else {
    console.log('   - Team Member Directory: ❌ FAIL (No team members)');
    allPassed = false;
  }

  // Test 2: Handoff Rules Retrieval & Auto-Seeding
  console.log('\n2. Testing Handoff Rules Database Operations...');
  const rules = await getHandoffRules();
  console.log(`   - Total active/seeded rules: ${rules.length}`);
  if (rules.length >= 4) {
    console.log('   - Rules auto-seeding: ✅ PASS');
  } else {
    console.log('   - Rules auto-seeding: ❌ FAIL');
    allPassed = false;
  }

  // Test 3: Create, Update, and Delete a Test Rule
  console.log('\n3. Testing Rule CRUD Operations...');
  try {
    const testRule = await createHandoffRule({
      name: 'Temporary Test Escalation Rule',
      description: 'Rule created during automated testing',
      isEnabled: true,
      ruleType: 'keyword_match',
      conditions: { keywords: ['test_keyword_escalate_xyz'] },
      actions: {
        autoPauseAi: true,
        assignToUserId: team[0]?.id,
        transitionMessage: 'Test handoff in progress',
      },
      priority: 999,
    });
    console.log(`   - Created rule ID: ${testRule.id} ✅ PASS`);

    await updateHandoffRule(testRule.id, { isEnabled: false, priority: 500 });
    console.log('   - Updated rule status to disabled ✅ PASS');

    await deleteHandoffRule(testRule.id);
    console.log('   - Deleted temporary test rule ✅ PASS');
  } catch (crudErr) {
    console.error('   - Rule CRUD error:', crudErr);
    allPassed = false;
  }

  // Test 4: Fast Intent Detection
  console.log('\n4. Testing Intent Classification Heuristics...');
  const intentTests = [
    { text: 'I want to speak with a human agent please', expected: 'human_agent_request' },
    { text: 'This is the worst service ever, I am furious and filing a complaint', expected: 'complaint_frustration' },
    { text: 'You double charged my card, I want a full refund', expected: 'billing_refund' },
    { text: 'Cancel my subscription right now', expected: 'cancellation' },
    { text: 'The system crashed with error 500', expected: 'technical_escalation' },
  ];

  for (const t of intentTests) {
    const detected = await classifyIntent(t.text);
    const pass = detected === t.expected;
    console.log(`   - Query: "${t.text.slice(0, 45)}..." -> Detected: ${detected} [${pass ? '✅ PASS' : '❌ FAIL'}]`);
    if (!pass) allPassed = false;
  }

  // Test 5: Confidence Calculation
  console.log('\n5. Testing AI Confidence Calculation...');
  const conf1 = calculateAIConfidence(
    "Our store is open Monday to Friday from 9 AM to 6 PM.",
    "What are your business hours?",
    "[Knowledge Source: Store Info]\nStore hours: Monday-Friday 9 AM to 6 PM."
  );
  console.log(`   - Grounded RAG answer confidence: ${(conf1 * 100).toFixed(0)}% (Expected >= 70%)`);

  const conf2 = calculateAIConfidence(
    "I'm sorry, that information is not currently available. Please contact us directly.",
    "What is your secret discount code?"
  );
  console.log(`   - Missing knowledge/uncertain answer confidence: ${(conf2 * 100).toFixed(0)}% (Expected <= 40%)`);

  if (conf1 >= 0.70 && conf2 <= 0.40) {
    console.log('   - Confidence Calculation: ✅ PASS');
  } else {
    console.log('   - Confidence Calculation: ❌ FAIL');
    allPassed = false;
  }

  // Test 6: Automated Handoff Rule Evaluation Engine
  console.log('\n6. Testing Rule Evaluation Engine Triggers...');

  // 6a: Keyword Match Trigger
  const eval1 = await evaluateHandoffRules({
    messageText: 'Hello, can I speak to a real person?',
  });
  console.log(`   - Keyword Match ("real person"): ${eval1.shouldHandoff ? '✅ TRIGGERED' : '❌ NOT TRIGGERED'} (Rule: "${eval1.matchedRule?.name}")`);
  if (!eval1.shouldHandoff) allPassed = false;

  // 6b: Intent Trigger (Complaint / Refund)
  const eval2 = await evaluateHandoffRules({
    messageText: 'I need an immediate refund for unauthorized charge',
  });
  console.log(`   - Intent Trigger (Billing/Refund): ${eval2.shouldHandoff ? '✅ TRIGGERED' : '❌ NOT TRIGGERED'} (Rule: "${eval2.matchedRule?.name}")`);
  if (!eval2.shouldHandoff) allPassed = false;

  // 6c: Low Confidence Trigger
  const eval3 = await evaluateHandoffRules({
    messageText: 'Complex question with low confidence',
    currentConfidence: 0.42, // Below 0.65 threshold
  });
  console.log(`   - Low Confidence Trigger (0.42 < 0.65): ${eval3.shouldHandoff ? '✅ TRIGGERED' : '❌ NOT TRIGGERED'} (Rule: "${eval3.matchedRule?.name}")`);
  if (!eval3.shouldHandoff) allPassed = false;

  // 6d: Consecutive Fallback Trigger
  const eval4 = await evaluateHandoffRules({
    messageText: 'Another question after 2 fallbacks',
    consecutiveFallbacks: 2,
  });
  console.log(`   - Consecutive Fallback Trigger (2 >= 2): ${eval4.shouldHandoff ? '✅ TRIGGERED' : '❌ NOT TRIGGERED'} (Rule: "${eval4.matchedRule?.name}")`);
  if (!eval4.shouldHandoff) allPassed = false;

  // 6e: Standard Query (Should NOT trigger handoff)
  const eval5 = await evaluateHandoffRules({
    messageText: 'What time do you open tomorrow?',
    currentConfidence: 0.88,
  });
  console.log(`   - Standard Safe Query: ${!eval5.shouldHandoff ? '✅ NO TRIGGER (Bot Replies)' : '❌ UNEXPECTED TRIGGER'}`);
  if (eval5.shouldHandoff) allPassed = false;

  // Test 7: Conversation Live Takeover DB Updates
  console.log('\n7. Testing Conversation Manual Takeover DB State...');
  const testChatId = 'test_customer_handoff@s.whatsapp.net';
  try {
    // Ensure test conversation exists
    await updateConversation(testChatId, {
      name: 'Test Customer Handoff',
      lastMessage: { text: 'Hello support', timestamp: Date.now() },
    });

    // Toggle takeover ON
    await setConversationTakeover(testChatId, true, team[0]?.id, 'Manual test takeover');
    const convosAfterPause = await getConversations();
    const pausedConvo = convosAfterPause.find(c => c.id === testChatId);
    const pauseVerified = pausedConvo?.isBotPaused === true && pausedConvo?.assignedUserId === team[0]?.id;
    console.log(`   - Manual Pause Takeover Activated: ${pauseVerified ? '✅ PASS' : '❌ FAIL'} (isBotPaused: ${pausedConvo?.isBotPaused})`);
    if (!pauseVerified) allPassed = false;

    // Toggle takeover OFF (Resume AI)
    await setConversationTakeover(testChatId, false);
    const convosAfterResume = await getConversations();
    const resumedConvo = convosAfterResume.find(c => c.id === testChatId);
    const resumeVerified = resumedConvo?.isBotPaused === false;
    console.log(`   - AI Auto-Reply Resumed: ${resumeVerified ? '✅ PASS' : '❌ FAIL'} (isBotPaused: ${resumedConvo?.isBotPaused})`);
    if (!resumeVerified) allPassed = false;
  } catch (convoErr) {
    console.error('   - Conversation takeover test error:', convoErr);
    allPassed = false;
  }

  console.log('\n============================================================');
  console.log(`  FINAL RESULT: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('============================================================\n');

  return allPassed;
}

// Direct execution
if (require.main === module) {
  runHandoffTestSuite().then(passed => {
    process.exit(passed ? 0 : 1);
  });
}
