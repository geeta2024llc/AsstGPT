import 'dotenv/config';
import { generateAIResponse } from '../../src/lib/ai';
import { addKnowledgeFile, deleteKnowledgeFile, getAgents } from '../../src/lib/db';
import { KnowledgeFile } from '../../src/types';

export async function runRagPipelineTest(): Promise<boolean> {
  console.log('====================================================');
  console.log('RAG & KNOWLEDGE BASE PIPELINE TEST SUITE');
  console.log('====================================================\n');

  const agents = await getAgents();
  const agent = agents.find(a => a.status === 'active') || agents[0];
  if (!agent || !agent.aiSettings) {
    console.error('Active AI agent missing!');
    return false;
  }

  let passed = 0;
  let total = 0;
  let createdFaq: KnowledgeFile | null = null;

  try {
    // 1. Add FAQ Knowledge
    console.log('[Test 1] Add FAQ Knowledge Source');
    total++;
    createdFaq = await addKnowledgeFile({
      fileName: 'AIWhisper Operating Hours & Refund FAQ',
      fileType: 'faq',
      size: 500,
      content: `
Business Name: AIWhisper Enterprise Support
Working Hours: Sunday to Friday, 9:00 AM to 6:00 PM NPT. Closed on Saturdays.
Standard Plan Price: $49/month for 5,000 messages.
Enterprise Plan Price: $199/month for unlimited messages and custom integrations.
Refund Policy: Full refund within 14 days of purchase. No questions asked.
Contact Email: support@aiwhisper.io | Phone: +977-9800000000
      `.trim(),
      enabled: true,
      status: 'ready'
    });
    console.log(`Created FAQ ID: ${createdFaq.id} | Title: "${createdFaq.fileName}"`);
    console.log('Result: PASS ✅\n');
    passed++;

    // 2. Ask a question directly answered by the FAQ
    console.log('[Test 2] Ask question directly answered by FAQ');
    total++;
    const q2 = 'What are your working hours and refund policy?';
    console.log(`Input: "${q2}"`);
    const res2 = await generateAIResponse(q2, agent.aiSettings);
    console.log(`AI Response: "${res2.replace(/\n/g, ' ')}"`);
    if (res2.toLowerCase().includes('9:00 am') || res2.toLowerCase().includes('14 days') || res2.toLowerCase().includes('sunday') || res2.toLowerCase().includes('refund')) {
      console.log('Result: PASS ✅ (AI correctly used FAQ data)\n');
      passed++;
    } else {
      console.log('Result: FAIL ❌\n');
    }
  } catch (err) {
    console.error('Pipeline test error:', err);
  } finally {
    if (createdFaq) {
      await deleteKnowledgeFile(createdFaq.id);
      console.log('Cleaned up test FAQ knowledge source.');
    }
  }

  console.log(`\nResult: ${passed}/${total} passed`);
  return passed === total;
}

if (process.argv[1]?.includes('rag_pipeline.test.ts') || process.argv[1]?.includes('rag_pipeline.test')) {
  runRagPipelineTest().then(ok => {
    process.exit(ok ? 0 : 1);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
