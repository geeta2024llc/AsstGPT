import 'dotenv/config';
import { addKnowledgeFile, deleteKnowledgeFile } from '../../src/lib/db';
import { retrieveRelevantKnowledgeContext } from '../../src/lib/ai';

export async function runSynonymsTest(): Promise<boolean> {
  console.log('\n====================================================');
  console.log('  RAG SYNONYMS & INTENT RETRIEVAL TEST');
  console.log('====================================================\n');

  const faq = await addKnowledgeFile({
    fileName: '[TEST] Hours FAQ',
    fileType: 'faq',
    size: 100,
    content: 'Support Hours: Monday to Friday, 9 AM to 6 PM NPT. Closed on weekends.\nRefund Policy: 14-day full refund. Basic Plan: $29/month.',
    enabled: true,
    status: 'ready',
  });

  const tests: Array<{ q: string; expectMatch: boolean }> = [
    { q: 'when are you open', expectMatch: true },
    { q: 'what are your hours', expectMatch: true },
    { q: 'how much does it cost', expectMatch: true },
    { q: 'pricing plans', expectMatch: true },
    { q: 'refund policy', expectMatch: true },
    { q: 'cancel subscription', expectMatch: true },
    { q: 'support hours', expectMatch: true },
    { q: 'hi', expectMatch: false },           // greeting bypass
    { q: 'hello', expectMatch: false },         // greeting bypass
    { q: 'namaste', expectMatch: false },       // greeting bypass
  ];

  let passed = 0;
  let total = 0;

  for (const { q, expectMatch } of tests) {
    const { sourcesUsed } = await retrieveRelevantKnowledgeContext(q, [faq.id]);
    const found = sourcesUsed.length > 0;
    const ok = found === expectMatch;
    total++;
    if (ok) passed++;
    const icon = ok ? '✅' : '❌';
    const note = expectMatch ? (found ? 'FOUND (correct)' : 'NOT FOUND (should match)') : (found ? 'FOUND (should be bypassed!)' : 'BYPASSED (correct)');
    console.log(`${icon} "${q}" → ${note}`);
  }

  await deleteKnowledgeFile(faq.id);
  console.log(`\nResult: ${passed}/${total} passed`);
  return passed === total;
}

if (process.argv[1]?.includes('synonyms.test.ts') || process.argv[1]?.includes('synonyms.test')) {
  runSynonymsTest().then(ok => {
    process.exit(ok ? 0 : 1);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
