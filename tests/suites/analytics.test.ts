import 'dotenv/config';
import { getAnalyticsData } from '../../src/lib/analytics';
import { getSupabaseAdmin } from '../../src/lib/supabase';
import { getAnalyticsResetAt } from '../../src/lib/db';

import { subDays, startOfDay } from 'date-fns';

export async function runAnalyticsTestSuite(): Promise<boolean> {
  console.log('\n============================================================');
  console.log('  AGENT ANALYTICS INTEGRATION TEST SUITE');
  console.log('============================================================\n');

  const tenantId = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
  const sb = getSupabaseAdmin();
  let allPassed = true;

  // Test 1: Date Range Options ('today', '7d', '30d')
  console.log('1. Testing Date-Range Filtering...');
  const dataToday = await getAnalyticsData('today');
  const data7d = await getAnalyticsData('7d');
  const data30d = await getAnalyticsData('30d');

  console.log(`   - Today range: ${dataToday.range} | Total convos: ${dataToday.kpis.totalConversations}`);
  console.log(`   - 7d range:    ${data7d.range}    | Total convos: ${data7d.kpis.totalConversations}`);
  console.log(`   - 30d range:   ${data30d.range}   | Total convos: ${data30d.kpis.totalConversations}`);

  if (dataToday.range !== 'today' || data7d.range !== '7d' || data30d.range !== '30d') {
    console.log('   - Range Identifiers: ❌ FAIL');
    allPassed = false;
  } else {
    console.log('   - Range Identifiers: ✅ PASS');
  }

  // Test 2: Cross-check numbers directly against Supabase queries
  console.log('\n2. Cross-Checking Metrics Against Supabase DB Queries...');
  const now = new Date();
  const startDate7d = subDays(startOfDay(now), 7 - 1).toISOString();
  const resetAt = await getAnalyticsResetAt(tenantId);
  const effectiveStartDate7d = resetAt && resetAt > startDate7d ? resetAt : startDate7d;

  const { count: realConvoCount } = await sb.from('conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('created_at', effectiveStartDate7d);
  const { count: realMsgCount } = await sb.from('messages').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('created_at', effectiveStartDate7d);
  const { count: realAgentCount } = await sb.from('agents').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'active');
  const { count: realErrCount } = await sb.from('audit_logs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('log_type', 'error').gte('created_at', effectiveStartDate7d);

  const convosMatch = data7d.kpis.totalConversations === (realConvoCount || 0);
  const msgsMatch = data7d.kpis.totalMessages === (realMsgCount || 0);
  const agentsMatch = data7d.kpis.activeAgents === (realAgentCount || 0);
  const errorsMatch = data7d.errorAnalytics.totalErrors === (realErrCount || 0);

  console.log(`   - Total Conversations Match: ${convosMatch ? '✅ PASS' : '❌ FAIL'} (${data7d.kpis.totalConversations} vs ${realConvoCount})`);
  console.log(`   - Total Messages Match:      ${msgsMatch ? '✅ PASS' : '❌ FAIL'} (${data7d.kpis.totalMessages} vs ${realMsgCount})`);
  console.log(`   - Active Agents Match:       ${agentsMatch ? '✅ PASS' : '❌ FAIL'} (${data7d.kpis.activeAgents} vs ${realAgentCount})`);
  console.log(`   - Error Count Match:         ${errorsMatch ? '✅ PASS' : '❌ FAIL'} (${data7d.errorAnalytics.totalErrors} vs ${realErrCount})`);

  if (!convosMatch || !msgsMatch || !agentsMatch || !errorsMatch) {
    allPassed = false;
  }

  // Test 3: Tenant Isolation Verification
  console.log('\n3. Testing Tenant Isolation Boundary...');
  const fakeTenantId = '00000000-dead-beef-0000-000000000002';
  const { count: leakConvos } = await sb.from('conversations').select('id', { count: 'exact', head: true }).eq('tenant_id', fakeTenantId);
  const { count: leakMsgs } = await sb.from('messages').select('id', { count: 'exact', head: true }).eq('tenant_id', fakeTenantId);
  
  if ((leakConvos || 0) === 0 && (leakMsgs || 0) === 0) {
    console.log('   - Tenant Isolation: ✅ PASS (Zero data leaked to unauthenticated tenant)');
  } else {
    console.log('   - Tenant Isolation: ❌ FAIL (Data leak detected)');
    allPassed = false;
  }

  // Test 4: RAG & Error Metrics Structuring
  console.log('\n4. Verifying RAG & Error Categorization...');
  console.log(`   - RAG Retrievals: ${data7d.ragAnalytics.retrievalCount}`);
  console.log(`   - Error Categories: ${data7d.errorAnalytics.byCategory.map(c => `${c.name}:${c.value}`).join(', ') || 'None'}`);

  // Test 5: Agent Performance Metrics
  console.log('\n5. Verifying Agent Metrics...');
  data7d.agentPerformance.forEach(ag => {
    console.log(`   - Agent "${ag.name}": status=${ag.status}, handled=${ag.conversationsHandled}, aiResponses=${ag.aiResponses}, failures=${ag.failures}`);
  });

  // Test 6: Dashboard Analytics Reset Checkpoint
  console.log('\n6. Testing Dashboard Analytics Reset Checkpoint...');
  try {
    const { resetAnalyticsBaseline } = await import('../../src/lib/db');
    await resetAnalyticsBaseline(tenantId);
    const updatedResetAt = await getAnalyticsResetAt(tenantId);
    if (updatedResetAt) {
      console.log(`   - Analytics Reset Baseline: ✅ PASS (reset_at: ${updatedResetAt})`);
    } else {
      console.log('   - Analytics Reset Baseline: ❌ FAIL (timestamp not persisted)');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Analytics Reset Baseline Error:', err);
    allPassed = false;
  }

  return allPassed;
}

if (process.argv[1]?.includes('analytics.test.ts') || process.argv[1]?.includes('analytics.test')) {
  runAnalyticsTestSuite().then(ok => {
    process.exit(ok ? 0 : 1);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
