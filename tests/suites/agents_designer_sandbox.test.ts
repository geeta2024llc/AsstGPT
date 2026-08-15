import 'dotenv/config';
import { testAgentReply } from '../../src/lib/actions';
import { getAgents, createAgent, updateAgent, deleteAgent, getAgent } from '../../src/lib/db';
import type { AISettings, Agent } from '../../src/types';

export async function runAgentsDesignerSandboxTestSuite(): Promise<boolean> {
  console.log('\n============================================================');
  console.log('  AGENTS DESIGNER & LIVE TEST SANDBOX TEST SUITE');
  console.log('============================================================\n');

  try {
    // -------------------------------------------------------------
    // Test 1: testAgentReply Server Action with Draft Settings
    // -------------------------------------------------------------
    console.log('1. Testing "Test Your Agent" Live Sandbox Action (testAgentReply)...');
    const draftAiSettings: AISettings = {
      provider: 'gemini',
      systemPrompt: 'You are a boutique hotel concierge in Kathmandu. Reply warmly in 1 short sentence.',
      maxLen: 100,
      temperature: 0.2,
      knowledgeFileIds: [],
      enableVision: true,
      enableVoiceResponse: false,
    };

    const testInputMessage = 'What time is check-in at the hotel?';
    const testResult = await testAgentReply({
      message: testInputMessage,
      aiSettings: draftAiSettings,
    });

    console.log(`   - Input Query: "${testInputMessage}"`);
    console.log(`   - Sandbox Reply: "${testResult.reply}"`);
    console.log(`   - Error (if any): ${testResult.error || 'None'}`);

    if (testResult.error || !testResult.reply) {
      console.error('❌ testAgentReply failed to generate a response');
      return false;
    }
    console.log('   - Sandbox Reply Generation: ✅ PASS\n');

    // -------------------------------------------------------------
    // Test 2: testAgentReply Error Boundary on Empty Input
    // -------------------------------------------------------------
    console.log('2. Testing Empty Input Guard on testAgentReply...');
    const emptyResult = await testAgentReply({
      message: '   ',
      aiSettings: draftAiSettings,
    });

    if (!emptyResult.error) {
      console.error('❌ testAgentReply should reject empty inputs');
      return false;
    }
    console.log(`   - Rejected empty input with message: "${emptyResult.error}"`);
    console.log('   - Empty Input Guard: ✅ PASS\n');

    // -------------------------------------------------------------
    // Test 3: Agent Creation, Mode Transition, and Status Toggle
    // -------------------------------------------------------------
    console.log('3. Testing Agent Lifecycle (Creation, AI -> Rule Mode, Status Toggle)...');
    const agentName = `Test Concierge Agent ${Date.now()}`;

    // Create Agent in AI Mode
    const created = await createAgent({
      name: agentName,
      description: 'Automated test concierge',
      mode: 'ai',
      status: 'active',
      fallbackResponse: 'Please contact front desk for assistance.',
      rules: [],
      aiSettings: draftAiSettings,
    });

    console.log(`   - Created Agent: "${created.name}" (ID: ${created.id}, Mode: ${created.mode})`);
    if (created.mode !== 'ai' || created.status !== 'active') {
      console.error('❌ Failed to create agent with correct mode/status');
      return false;
    }

    // Update Agent to Keyword Rule Mode
    const updated = await updateAgent(created.id, {
      mode: 'rule',
      rules: [
        {
          id: `rule_${Date.now()}`,
          trigger: { type: 'keywords', value: 'hours, timing, checkin' },
          responses: ['Check-in is available 24/7 at the front desk.'],
        },
      ],
      status: 'paused',
    });

    console.log(`   - Updated Mode to: "${updated?.mode}", Status: "${updated?.status}", Rules Count: ${updated?.rules.length}`);
    if (updated?.mode !== 'rule' || updated?.status !== 'paused' || updated?.rules.length !== 1) {
      console.error('❌ Failed to update agent to rule mode');
      return false;
    }

    // Cleanup Agent
    const deleted = await deleteAgent(created.id);
    console.log(`   - Cleaned up agent: deleted=${deleted}`);
    const checkDeleted = await getAgent(created.id);
    if (checkDeleted) {
      console.error('❌ Agent was not deleted properly');
      return false;
    }
    console.log('   - Agent Lifecycle & Mode Transitions: ✅ PASS\n');

    console.log('============================================================');
    console.log('  FINAL RESULT: 🎉 ALL AGENT DESIGNER & SANDBOX TESTS PASSED');
    console.log('============================================================\n');
    return true;
  } catch (err) {
    console.error('💥 Test suite encountered fatal error:', err);
    return false;
  }
}

if (
  process.argv[1]?.includes('agents_designer_sandbox.test.ts') ||
  process.argv[1]?.includes('agents_designer_sandbox.test')
) {
  runAgentsDesignerSandboxTestSuite().then(ok => {
    process.exit(ok ? 0 : 1);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
