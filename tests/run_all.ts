import 'dotenv/config';
import { runSynonymsTest } from './suites/synonyms.test';
import { runAnalyticsTestSuite } from './suites/analytics.test';
import { runAuditAnalyticsTest } from './suites/audit_analytics.test';
import { runPipelineTest } from './suites/pipeline.test';
import { runRagE2ETestSuite } from './suites/rag_e2e.test';
import { runMultimodalTestSuite } from './suites/multimodal.test';

interface SuiteResult {
  name: string;
  passed: boolean;
  durationMs: number;
}

async function runMasterTestSuite() {
  console.log('\n============================================================');
  console.log('       AIWHISPER MASTER TEST RUNNER & VERIFICATION');
  console.log('============================================================\n');

  const suites: Array<{ name: string; runner: () => Promise<boolean> }> = [
    { name: 'Multimodal & Voice Processing', runner: runMultimodalTestSuite },
    { name: 'Synonyms & Keyword Retrieval', runner: runSynonymsTest },
    { name: 'Pipeline & Environment Check', runner: runPipelineTest },
    { name: 'Analytics & DB Query Verification', runner: runAnalyticsTestSuite },
    { name: 'Audit Logs & DB Health', runner: runAuditAnalyticsTest },
    { name: 'RAG End-to-End & Anti-Hallucination', runner: runRagE2ETestSuite },
  ];

  const results: SuiteResult[] = [];

  for (const s of suites) {
    console.log(`\n▶ Running Suite: ${s.name}...`);
    const start = Date.now();
    try {
      const passed = await s.runner();
      const durationMs = Date.now() - start;
      results.push({ name: s.name, passed, durationMs });
    } catch (err) {
      console.error(`Suite "${s.name}" threw an unhandled error:`, err);
      results.push({ name: s.name, passed: false, durationMs: Date.now() - start });
    }
  }

  console.log('\n============================================================');
  console.log('                   MASTER TEST SUMMARY');
  console.log('============================================================');

  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status.padEnd(8)} | ${r.name.padEnd(42)} | ${(r.durationMs / 1000).toFixed(2)}s`);
    if (!r.passed) allPassed = false;
  }

  console.log('============================================================');
  console.log(allPassed ? '🎉 ALL SUITES PASSED SUCCESSFULLY!' : '⚠️ SOME TEST SUITES FAILED!');
  console.log('============================================================\n');

  process.exit(allPassed ? 0 : 1);
}

runMasterTestSuite().catch(err => {
  console.error('Master test runner crashed:', err);
  process.exit(1);
});
