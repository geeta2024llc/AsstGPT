import 'dotenv/config';
import { generateAIResponse } from '../../src/lib/ai';
import { getAgents, getMessages, getConversations } from '../../src/lib/db';

export async function runPipelineTest(): Promise<boolean> {
  console.log('--- TESTING GEMINI + SUPABASE PIPELINE ---');
  
  // 1. Verify GEMINI_API_KEY presence in process env
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;
  console.log('1. GEMINI_API_KEY loaded in process.env:', !!apiKey, apiKey ? '(REDACTED - length: ' + apiKey.length + ')' : '(MISSING)');

  // 2. Fetch default agent settings
  const agents = await getAgents();
  const agent = agents.find(a => a.status === 'active') || agents[0];
  console.log('2. Active Agent resolved:', agent?.name, '| Mode:', agent?.mode, '| Provider:', agent?.aiSettings?.provider);

  if (!agent || !agent.aiSettings) {
    console.error('FAILED: No agent or AI settings found');
    return false;
  }

  // 3. Test direct Gemini AI response generation
  console.log('3. Executing Gemini AI response generation...');
  try {
    const aiResponse = await generateAIResponse('Hello, are you available?', agent.aiSettings);
    console.log('4. Gemini AI Response generated successfully!');
    console.log('--- GENERATED RESPONSE TEXT ---');
    console.log(aiResponse);
    console.log('-------------------------------');
  } catch (err) {
    console.error('4. Gemini AI Generation FAILED:', (err as Error).message);
    return false;
  }

  // 4. Verify Supabase conversations & messages
  const convos = await getConversations();
  console.log('5. Supabase Conversations count:', convos.length);
  if (convos.length > 0) {
    console.log('   Recent Conversation:', {
      id: convos[0].id,
      name: convos[0].name,
      unreadCount: convos[0].unreadCount,
      lastMessage: convos[0].lastMessage,
    });
  }

  const msgs = await getMessages();
  console.log('6. Supabase Messages count:', msgs.length);
  if (msgs.length > 0) {
    console.log('   Latest Message:', msgs[msgs.length - 1]);
  }

  return true;
}

if (process.argv[1]?.includes('pipeline.test.ts') || process.argv[1]?.includes('pipeline.test')) {
  runPipelineTest().then(ok => {
    process.exit(ok ? 0 : 1);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
