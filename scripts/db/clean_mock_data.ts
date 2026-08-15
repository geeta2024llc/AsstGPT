import 'dotenv/config';
import { getSupabaseAdmin } from '../../src/lib/supabase';

async function main() {
  const supabase = getSupabaseAdmin();
  const tenantId = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

  console.log(`[CLEANUP] Scanning database for mock/demo test data for tenant: ${tenantId}...`);

  const mockNames = [
    'Lifecycle Test Customer',
    'Alexander Sterling',
    'Eleanor Vance',
    'Website Visitor',
    'Client Pro Inquiries',
    'Coder',
    'Temporary Test Greeting',
    'Updated Test Greeting',
  ];

  // 1. Find mock contacts
  const { data: contacts, error: cErr } = await supabase
    .from('contacts')
    .select('id, name')
    .eq('tenant_id', tenantId);

  if (cErr) {
    console.error('Error fetching contacts:', cErr);
    return;
  }

  const contactsToDelete = (contacts || []).filter(c => {
    if (!c.name) return false;
    if (mockNames.includes(c.name)) return true;
    if (c.name.startsWith('[TEST]') || c.name.startsWith('Test ')) return true;
    return false;
  });

  console.log(`[CLEANUP] Found ${contactsToDelete.length} mock contact(s) to remove:`, contactsToDelete.map(c => c.name));

  for (const c of contactsToDelete) {
    const { error: delErr } = await supabase.from('contacts').delete().eq('id', c.id).eq('tenant_id', tenantId);
    if (delErr) {
      console.error(`Failed to delete contact ${c.name} (${c.id}):`, delErr);
    } else {
      console.log(`✅ Deleted mock contact: "${c.name}"`);
    }
  }

  // 2. Find any remaining mock contact_channels with test external_ids
  const { data: contactChannels } = await supabase
    .from('contact_channels')
    .select('id, contact_id, external_id')
    .eq('tenant_id', tenantId);

  const testChannels = (contactChannels || []).filter(cc => {
    const ext = cc.external_id || '';
    return ext.startsWith('test_') || ext.startsWith('1555000') || ext.startsWith('webchat_session_test');
  });

  console.log(`[CLEANUP] Found ${testChannels.length} test channel(s) to remove:`, testChannels.map(tc => tc.external_id));
  for (const tc of testChannels) {
    if (tc.contact_id) {
      await supabase.from('contacts').delete().eq('id', tc.contact_id).eq('tenant_id', tenantId);
      console.log(`✅ Deleted test contact for channel: "${tc.external_id}"`);
    }
  }

  console.log('[CLEANUP] Mock and test data cleanup completed successfully!');
}

main().catch(console.error);
