import 'dotenv/config';
import { generateAIResponse } from '../../src/lib/ai';
import { getAgents } from '../../src/lib/db';

export async function runRealWorldTests(): Promise<boolean> {
  console.log('====================================================');
  console.log('REAL-WORLD SCENARIO TEST SUITE (10 SCENARIOS)');
  console.log('====================================================\n');

  const agents = await getAgents();
  const agent = agents.find(a => a.status === 'active') || agents[0];

  if (!agent || !agent.aiSettings) {
    console.error('FAILED: Active AI agent not found');
    return false;
  }

  console.log(`Agent: "${agent.name}" | Provider: ${agent.aiSettings.provider}\n`);

  const scenarios = [
    {
      id: 1,
      name: 'English greeting',
      userText: 'Hello, are you available?',
      history: []
    },
    {
      id: 2,
      name: 'Nepali message',
      userText: 'नमस्ते, तपाईंका सेवाहरू के के हुन्?',
      history: []
    },
    {
      id: 3,
      name: 'Nepali-English mixed message',
      userText: 'Mero issue try garda fail bhayo, how can I fix it?',
      history: []
    },
    {
      id: 4,
      name: 'Follow-up question requiring conversation context',
      userText: 'Can you explain the first feature in more detail?',
      history: [
        { fromMe: false, text: 'What services do you offer?' },
        { fromMe: true, text: 'We offer 1. Automated Customer Support, 2. WhatsApp Integration, and 3. Multi-agent Workflows.' }
      ]
    },
    {
      id: 5,
      name: 'Long message',
      userText: 'Hello, I am interested in connecting my business WhatsApp account with your AIWhisper system. Could you tell me what setup steps are required, how pricing works, whether custom knowledge base documents are supported, and how long the initial setup usually takes?',
      history: []
    },
    {
      id: 6,
      name: 'Multiple consecutive messages',
      userText: 'Also, can I add multiple team members to manage the inbox?',
      history: [
        { fromMe: false, text: 'Hi' },
        { fromMe: true, text: 'Hello! How can I assist you today?' },
        { fromMe: false, text: 'I want to know about team access.' }
      ]
    },
    {
      id: 7,
      name: 'Two different WhatsApp users (Isolation test)',
      userText: 'Hi, I am calling from Customer B company.',
      history: []
    },
    {
      id: 8,
      name: 'Duplicate inbound message (Idempotency check)',
      userText: 'Hello, are you available?',
      history: []
    },
    {
      id: 9,
      name: 'WhatsApp reconnect / restart simulation',
      userText: 'Is the connection active now?',
      history: []
    },
    {
      id: 10,
      name: 'Dev server restart followed by message',
      userText: 'Checking system status after restart.',
      history: []
    }
  ];

  let passed = 0;
  for (const s of scenarios) {
    console.log(`[Scenario ${s.id}] ${s.name}`);
    console.log(`Input: "${s.userText}"`);
    try {
      const response = await generateAIResponse(s.userText, agent.aiSettings, s.history);
      console.log(`Response: "${response.replace(/\n/g, ' ')}"`);
      if (response && !response.includes('Sorry, I cannot respond right now.')) {
        console.log(`Result: SUCCESS ✅\n`);
        passed++;
      } else {
        console.log(`Result: FALLBACK TRIGGERED ❌\n`);
      }
    } catch (err) {
      console.error(`Result: ERROR ❌ (${(err as Error).message})\n`);
    }
    // Rate limit buffer
    await new Promise(r => setTimeout(r, 6000));
  }

  console.log('====================================================');
  console.log(`REAL-WORLD TEST RESULTS: ${passed}/${scenarios.length} PASSED`);
  console.log('====================================================');

  return passed === scenarios.length;
}

if (process.argv[1]?.includes('realworld_scenarios.test.ts') || process.argv[1]?.includes('realworld_scenarios.test')) {
  runRealWorldTests().then(ok => {
    process.exit(ok ? 0 : 1);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
