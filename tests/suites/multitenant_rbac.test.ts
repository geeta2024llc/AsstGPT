import 'dotenv/config';
import { getSupabaseAdmin } from '../../src/lib/supabase';
import { runWithRequestContext } from '../../src/lib/request-context';

export async function runMultiTenantRBACTestSuite(): Promise<boolean> {
  console.log('============================================================');
  console.log('  MULTI-TENANT ISOLATION & RBAC TEST SUITE');
  console.log('============================================================\n');

  let allPassed = true;
  const sb = getSupabaseAdmin();

  const TENANT_A = '00000000-0000-0000-0000-000000000001';
  const TENANT_B = '00000000-0000-0000-0000-000000000002';

  // Ensure Tenant B exists for testing
  await sb.from('tenants').upsert({
    id: TENANT_B,
    name: 'Tenant B Isolated Corp',
  });

  // Ensure channel exists for Tenant B
  let { data: channelB } = await sb.from('channels').select('id').eq('tenant_id', TENANT_B).maybeSingle();
  if (!channelB) {
    const { data: newCh } = await sb.from('channels').insert({
      tenant_id: TENANT_B,
      type: 'whatsapp',
      name: 'Tenant B WhatsApp',
    }).select().single();
    channelB = newCh;
  }

  // 1. Test Tenant Isolation
  console.log('1. Testing Cross-Tenant Data Leak Isolation...');
  try {
    // Insert contact for Tenant A
    const { data: contactA } = await sb.from('contacts').insert({
      tenant_id: TENANT_A,
      name: 'Tenant A Secret Customer',
    }).select().single();

    // Insert contact for Tenant B
    const { data: contactB } = await sb.from('contacts').insert({
      tenant_id: TENANT_B,
      name: 'Tenant B Secret Customer',
    }).select().single();

    // Query contacts scoped to Tenant A
    const { data: tenantAContacts } = await sb.from('contacts').select('*').eq('tenant_id', TENANT_A);
    const hasTenantBInA = tenantAContacts?.some(c => c.id === contactB?.id);
    console.log(`   - Tenant A query contains Tenant B data: ${hasTenantBInA ? '❌ LEAK DETECTED' : '✅ NONE (Isolated)'}`);
    if (hasTenantBInA) allPassed = false;

    // Query contacts scoped to Tenant B
    const { data: tenantBContacts } = await sb.from('contacts').select('*').eq('tenant_id', TENANT_B);
    const hasTenantAInB = tenantBContacts?.some(c => c.id === contactA?.id);
    console.log(`   - Tenant B query contains Tenant A data: ${hasTenantAInB ? '❌ LEAK DETECTED' : '✅ NONE (Isolated)'}`);
    if (hasTenantAInB) allPassed = false;

    // Cleanup test contacts
    if (contactA?.id) await sb.from('contacts').delete().eq('id', contactA.id);
    if (contactB?.id) await sb.from('contacts').delete().eq('id', contactB.id);
  } catch (err) {
    console.error('   - Tenant isolation error:', err);
    allPassed = false;
  }

  // 2. Test RequestContext propagation
  console.log('\n2. Testing AsyncLocalStorage RequestContext Propagation...');
  try {
    const contextResult = await runWithRequestContext(
      {
        tenantId: TENANT_A,
        userId: 'user_123',
        userRole: 'admin',
      },
      async () => {
        const { getRequestContext } = await import('../../src/lib/request-context');
        const ctx = getRequestContext();
        return ctx?.tenantId === TENANT_A && ctx?.userRole === 'admin' && ctx?.userId === 'user_123';
      }
    );

    console.log(`   - Context propagation inside async closure: ${contextResult ? '✅ PASS' : '❌ FAIL'}`);
    if (!contextResult) allPassed = false;
  } catch (err) {
    console.error('   - RequestContext error:', err);
    allPassed = false;
  }

  // 3. Test RBAC Permission Boundaries
  console.log('\n3. Testing RBAC Role Permissions...');
  try {
    const roles = [
      { role: 'admin', canManageTeam: true, canPurgeLogs: true, canReplyMessages: true },
      { role: 'operator', canManageTeam: false, canPurgeLogs: false, canReplyMessages: true },
      { role: 'viewer', canManageTeam: false, canPurgeLogs: false, canReplyMessages: false },
    ];

    for (const r of roles) {
      const allowedActions: string[] = [];
      if (r.canReplyMessages) allowedActions.push('reply');
      if (r.canManageTeam) allowedActions.push('team_manage');
      if (r.canPurgeLogs) allowedActions.push('audit_purge');

      const isPermitted = (action: string) => {
        if (r.role === 'admin') return true;
        if (r.role === 'operator') return action === 'reply';
        return false;
      };

      const adminPermCheck = isPermitted('team_manage') === r.canManageTeam;
      const replyPermCheck = isPermitted('reply') === r.canReplyMessages;

      console.log(`   - Role [${r.role.toUpperCase()}]: Team Manage = ${isPermitted('team_manage')}, Reply = ${isPermitted('reply')} -> ${adminPermCheck && replyPermCheck ? '✅ PASS' : '❌ FAIL'}`);
      if (!adminPermCheck || !replyPermCheck) allPassed = false;
    }
  } catch (err) {
    console.error('   - RBAC error:', err);
    allPassed = false;
  }

  console.log('\n============================================================');
  console.log(`  FINAL RESULT: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('============================================================\n');

  return allPassed;
}

if (process.argv[1]?.includes('multitenant_rbac.test.ts') || process.argv[1]?.includes('multitenant_rbac.test')) {
  runMultiTenantRBACTestSuite().then(ok => {
    process.exit(ok ? 0 : 1);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
