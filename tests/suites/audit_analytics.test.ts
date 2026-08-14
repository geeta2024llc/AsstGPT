import 'dotenv/config';
import { getSupabaseAdmin } from '../../src/lib/supabase';

export async function runAuditAnalyticsTest(): Promise<boolean> {
  const sb = getSupabaseAdmin();
  const tenantId = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

  console.log('\n--- AUDIT ANALYTICS DATA (TENANT:', tenantId, ') ---');

  const { data: convos, error: convErr } = await sb.from('conversations').select('*').eq('tenant_id', tenantId);
  if (convErr) {
    console.error('Failed to fetch conversations:', convErr);
    return false;
  }
  console.log('Conversations count:', convos?.length || 0);

  const { data: msgs, error: msgErr } = await sb.from('messages').select('*').eq('tenant_id', tenantId).limit(10);
  if (msgErr) {
    console.error('Failed to fetch messages:', msgErr);
    return false;
  }
  console.log('Messages count sample:', msgs?.length || 0);

  const { data: logs, error: logErr } = await sb.from('audit_logs').select('action, log_type, user_name').eq('tenant_id', tenantId).limit(20);
  if (logErr) {
    console.error('Failed to fetch audit logs:', logErr);
    return false;
  }
  console.log('Audit logs sample count:', logs?.length || 0);

  const { data: agents, error: agentErr } = await sb.from('agents').select('*').eq('tenant_id', tenantId);
  if (agentErr) {
    console.error('Failed to fetch agents:', agentErr);
    return false;
  }
  console.log('Agents active count:', agents?.filter(a => a.status === 'active').length || 0);

  return true;
}

if (process.argv[1]?.includes('audit_analytics.test.ts') || process.argv[1]?.includes('audit_analytics.test')) {
  runAuditAnalyticsTest().then(ok => {
    process.exit(ok ? 0 : 1);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
