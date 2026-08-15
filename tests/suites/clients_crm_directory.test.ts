import { config } from 'dotenv';
config();

import { getSupabaseAdmin } from '../../src/lib/supabase';
import {
  getAllContactProfiles,
  updateContactProfile,
  addMessage,
  ensureDefaultTenantAndChannel,
} from '../../src/lib/db';
import type { LeadStage } from '../../src/types';

async function runClientsCRMDirectoryTests() {
  console.log('============================================================');
  console.log('  CLIENT DETAIL CRM DIRECTORY TEST SUITE');
  console.log('============================================================\n');

  const supabase = getSupabaseAdmin();
  const { tenantId, channelId } = await ensureDefaultTenantAndChannel();
  const timestamp = Date.now();

  const testPhone = `98000${Math.floor(10000 + Math.random() * 90000)}`;
  const testChatId = `${testPhone}@s.whatsapp.net`;

  // 1. Create a sample contact with messages and CRM details
  console.log('1. Creating sample CRM client profile with full attributes...');
  await addMessage({
    id: `msg_crm_test_${timestamp}_1`,
    chatId: testChatId,
    text: 'Hello, I am interested in Enterprise AI deployment for my company.',
    timestamp,
    fromMe: false,
    senderName: 'Sanjay Thapa',
  });

  await addMessage({
    id: `msg_crm_test_${timestamp}_2`,
    chatId: testChatId,
    text: 'Our team is based in Kathmandu and we need custom SLAs.',
    timestamp: timestamp + 1000,
    fromMe: false,
    senderName: 'Sanjay Thapa',
  });

  const updatedProfile = await updateContactProfile(testChatId, {
    name: 'Sanjay Thapa',
    email: 'sanjay@himalayanlogistics.com',
    company: 'Himalayan Logistics Corp',
    stage: 'customer',
    tags: ['Enterprise', 'Kathmandu HQ'],
    notes: 'Approved standard contract for 50 agents.',
  });

  if (
    updatedProfile.name !== 'Sanjay Thapa' ||
    updatedProfile.email !== 'sanjay@himalayanlogistics.com' ||
    updatedProfile.company !== 'Himalayan Logistics Corp' ||
    updatedProfile.stage !== 'customer'
  ) {
    throw new Error('Failed to persist full CRM client attributes in DB.');
  }
  console.log('   - Contact Name:', updatedProfile.name);
  console.log('   - Email:', updatedProfile.email);
  console.log('   - Company:', updatedProfile.company);
  console.log('   - Stage:', updatedProfile.stage);
  console.log('   - Client Attributes Persistence: ✅ PASS\n');

  // 2. Test getAllContactProfiles retrieval and data contract
  console.log('2. Testing getAllContactProfiles() data contract and aggregations...');
  const res = await getAllContactProfiles();

  console.log(`   - Total clients retrieved: ${res.total}`);
  console.log('   - Stage counts:', JSON.stringify(res.stageCounts));

  const targetClient = res.clients.find((c) => c.externalId === testChatId || c.name === 'Sanjay Thapa');
  if (!targetClient) {
    throw new Error(`Target test client ${testChatId} not found in getAllContactProfiles result.`);
  }

  // Validate all required columns
  if (!targetClient.name) throw new Error('Missing client name');
  if (!targetClient.formattedPhone) throw new Error('Missing formatted phone');
  if (!targetClient.createdAt) throw new Error('Missing date contacted (createdAt)');
  if (!targetClient.stage) throw new Error('Missing lifecycle stage');
  if (targetClient.email !== 'sanjay@himalayanlogistics.com') throw new Error('Email mismatch');
  if (targetClient.company !== 'Himalayan Logistics Corp') throw new Error('Company mismatch');
  if (typeof targetClient.messageCount !== 'number' || targetClient.messageCount < 2) {
    throw new Error(`Expected messageCount >= 2, got ${targetClient.messageCount}`);
  }

  console.log('   - Validated Required Table Columns:');
  console.log(`     * Name: "${targetClient.name}"`);
  console.log(`     * Phone: "${targetClient.formattedPhone}"`);
  console.log(`     * Date Contacted: ${new Date(targetClient.createdAt).toISOString()}`);
  console.log(`     * Stage: "${targetClient.stage}"`);
  console.log(`     * Email: "${targetClient.email}"`);
  console.log(`     * Company: "${targetClient.company}"`);
  console.log(`     * Total Messages: ${targetClient.messageCount}`);
  console.log('   - Data Contract Verification: ✅ PASS\n');

  // 3. Testing Search Filtering
  console.log('3. Testing Search Filtering across Name, Phone, Email, Company...');
  const searchByName = await getAllContactProfiles({ search: 'Sanjay' });
  const foundByName = searchByName.clients.some((c) => c.externalId === testChatId);
  if (!foundByName) throw new Error('Search by name failed.');

  const searchByEmail = await getAllContactProfiles({ search: 'himalayanlogistics' });
  const foundByEmail = searchByEmail.clients.some((c) => c.externalId === testChatId);
  if (!foundByEmail) throw new Error('Search by email failed.');

  const searchByCompany = await getAllContactProfiles({ search: 'Himalayan Logistics' });
  const foundByCompany = searchByCompany.clients.some((c) => c.externalId === testChatId);
  if (!foundByCompany) throw new Error('Search by company failed.');

  console.log('   - Search by Name: ✅ Found');
  console.log('   - Search by Email: ✅ Found');
  console.log('   - Search by Company: ✅ Found');
  console.log('   - Search Filter: ✅ PASS\n');

  // 4. Testing Lifecycle Stage Filter
  console.log('4. Testing Lifecycle Stage Filtering...');
  const filterByCustomer = await getAllContactProfiles({ stage: 'customer' });
  const allAreCustomers = filterByCustomer.clients.every((c) => c.stage === 'customer');
  if (!allAreCustomers) throw new Error('Stage filter returned non-customer records.');
  console.log(`   - Customer Stage filter returned ${filterByCustomer.total} records (All verified: customer)`);
  console.log('   - Stage Filter: ✅ PASS\n');

  // 5. Testing 1-Click Lifecycle Stage Progression in DB
  console.log('5. Testing 1-Click Lifecycle Stage Progression (Customer -> VIP)...');
  const vipUpdated = await updateContactProfile(testChatId, { stage: 'vip' });
  if (vipUpdated.stage !== 'vip') throw new Error('Failed to upgrade stage to VIP.');

  const verifyVIP = await getAllContactProfiles({ stage: 'vip' });
  const foundVIP = verifyVIP.clients.some((c) => c.externalId === testChatId);
  if (!foundVIP) throw new Error('Upgraded VIP client not found in VIP filter query.');

  console.log('   - Upgraded to VIP: ✅ Confirmed');
  console.log('   - Stage Progression: ✅ PASS\n');

  console.log('============================================================');
  console.log('  FINAL RESULT: 🎉 ALL CLIENT CRM DIRECTORY TESTS PASSED');
  console.log('============================================================');
}

runClientsCRMDirectoryTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
