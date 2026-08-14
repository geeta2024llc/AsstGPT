import 'dotenv/config';
import { getAgents, addAgent } from '../../src/lib/db';

async function main() {
  console.log('Seeding default tenant, channel, and agent into live database...');

  const agents = await getAgents();
  console.log('Existing agents in live database:', agents);

  if (agents.length === 0) {
    console.log('Creating default AI agent...');
    const newAgent = await addAgent({
      name: 'AI Support Assistant',
      description: 'Default automated AI support agent powered by Gemini',
      mode: 'ai',
      fallbackResponse: 'Sorry, I am currently unable to assist with that.',
      status: 'active',
      rules: [],
      aiSettings: {
        provider: 'gemini',
        systemPrompt: 'You are a helpful customer service representative. Reply concisely and politely to customer inquiries.',
        maxLen: 300,
        temperature: 0.7,
        knowledgeFileIds: [],
      },
    });
    console.log('Default AI agent created successfully:', newAgent);
  }
}

main().catch(console.error);
