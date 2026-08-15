import 'dotenv/config';
import { runSynonymsTest } from './suites/synonyms.test';
import { runAnalyticsTestSuite } from './suites/analytics.test';
import { runAuditAnalyticsTest } from './suites/audit_analytics.test';
import { runPipelineTest } from './suites/pipeline.test';
import { runRagE2ETestSuite } from './suites/rag_e2e.test';
import { runMultimodalTestSuite } from './suites/multimodal.test';
import { runHandoffTestSuite } from './suites/handoff_takeover.test';
import { runPhase1TestSuite } from './suites/phase1_productivity.test';
import { runPhase2TestSuite } from './suites/phase2_notes.test';
import { runPhase3TestSuite } from './suites/phase3_crm.test';
import { runPhase4TestSuite } from './suites/phase4_webhooks.test';
import { runPhase5TestSuite } from './suites/phase5_analytics.test';
import { runPhase6TestSuite } from './suites/phase6_widget.test';
import { runPhase7TestSuite as runRbacTestSuite } from './suites/phase7_rbac.test';
import { runPhase7TestSuite as runProductionHardeningTestSuite } from './suites/phase7_production.test';
import { runMultiTenantRBACTestSuite } from './suites/multitenant_rbac.test';
import { runAIFailureAndTakeoverRaceTestSuite } from './suites/ai_failure_and_takeover_races.test';
import { runAdversarialSecurityAudit } from './suites/adversarial_multitenant_security.test';
import { runRailwayAndMultiReplicaTestSuite } from './suites/railway_multi_replica_resilience.test';

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
    { name: 'Handoff Rules & Live Takeover', runner: runHandoffTestSuite },
    { name: 'Canned Responses & Lifecycle', runner: runPhase1TestSuite },
    { name: 'Internal Team Notes', runner: runPhase2TestSuite },
    { name: 'Contact CRM & Customer Profiles', runner: runPhase3TestSuite },
    { name: 'Outbound Webhooks & HMAC Dispatch', runner: runPhase4TestSuite },
    { name: 'Analytics & Sentiment Insights', runner: runPhase5TestSuite },
    { name: 'Live Web Chat Widget', runner: runPhase6TestSuite },
    { name: 'Team Roles & RBAC', runner: runRbacTestSuite },
    { name: 'Production Hardening & Idempotency', runner: runProductionHardeningTestSuite },
    { name: 'Multi-Tenant Isolation & Security', runner: runMultiTenantRBACTestSuite },
    { name: 'AI Failure Resilience & Takeover Races', runner: runAIFailureAndTakeoverRaceTestSuite },
    { name: 'Adversarial Multi-Tenant Security Audit', runner: runAdversarialSecurityAudit },
    { name: 'Railway Persistence & Multi-Replica Failover', runner: runRailwayAndMultiReplicaTestSuite },
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
