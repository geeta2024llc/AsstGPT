import 'dotenv/config';
import { getSupabaseAdmin } from '../../src/lib/supabase';
import {
  addMessage,
  getConversations,
  getMessages,
  mergeDuplicateContacts,
  mergeContactByChatId,
} from '../../src/lib/db';
import { formatContactName, getAvatarInitials } from '../../src/lib/format-utils';
import type { Message } from '../../src/types';

export async function runContactDedupAndJidReconciliationTestSuite(): Promise<boolean> {
  console.log('============================================================');
  console.log('  CONTACT DEDUP, JID/LID RECONCILIATION & SYNC TEST SUITE');
  console.log('============================================================\n');

  let allPassed = true;
  const sb = getSupabaseAdmin();

  const PHONE = '9841000055';
  const JID_DEVICE = `${PHONE}:12@s.whatsapp.net`;
  const JID_STANDARD = `${PHONE}@s.whatsapp.net`;
  const JID_LID = '28938291038@lid';

  // --------------------------------------------------------------------------
  // TEST 1: Device Suffix Stripping & Single Contact Creation
  // --------------------------------------------------------------------------
  console.log('1. Testing Device-Suffixed JID and Standard JID Reconciliation...');
  try {
    const msg1: Message = {
      id: `msg_dev_${Date.now()}`,
      chatId: JID_DEVICE,
      senderName: PHONE,
      fromMe: false,
      text: 'Message from multi-device WhatsApp client',
      timestamp: Date.now() - 5000,
    };
    await addMessage(msg1);

    const msg2: Message = {
      id: `msg_std_${Date.now()}`,
      chatId: JID_STANDARD,
      senderName: PHONE,
      fromMe: false,
      text: 'Message from primary phone',
      timestamp: Date.now(),
    };
    await addMessage(msg2);

    const convos = await getConversations();
    const matchingConvos = convos.filter(c => c.id.includes(PHONE) || c.name.includes(PHONE));
    const isSingleConvo = matchingConvos.length === 1;

    console.log(`   - Found matching conversation count: ${matchingConvos.length} (Expected 1)`);
    console.log(`   - Conversation ID: "${matchingConvos[0]?.id}", Last message: "${matchingConvos[0]?.lastMessage.text}"`);
    console.log(`   - Device Suffix Reconciliation: ${isSingleConvo ? '✅ PASS' : '❌ FAIL'}\n`);
    if (!isSingleConvo) allPassed = false;
  } catch (err: any) {
    console.error('   - Test 1 error:', err.message);
    allPassed = false;
  }

  // --------------------------------------------------------------------------
  // TEST 2: Dynamic Contact Name Upgrade (Phone Digits -> Real Human Name)
  // --------------------------------------------------------------------------
  console.log('2. Testing Dynamic Contact Name Upgrade from WhatsApp pushName...');
  try {
    // Send 3rd message with a real human push name
    const msg3: Message = {
      id: `msg_name_${Date.now()}`,
      chatId: JID_STANDARD,
      senderName: 'Sherpa Mingma',
      fromMe: false,
      text: 'Hi, this is Sherpa Mingma from Nepal',
      timestamp: Date.now(),
    };
    await addMessage(msg3);

    const convos = await getConversations();
    const convo = convos.find(c => c.id.includes(PHONE) || c.name === 'Sherpa Mingma');
    const nameUpgraded = convo?.name === 'Sherpa Mingma';
    const avatarInitials = getAvatarInitials(convo?.name, convo?.id);
    const initialsCorrect = avatarInitials === 'SM';

    console.log(`   - Contact name in DB: "${convo?.name}" (Expected "Sherpa Mingma")`);
    console.log(`   - Avatar initials derived: "${avatarInitials}" (Expected "SM")`);
    console.log(`   - Contact Name Upgrade & Avatar: ${nameUpgraded && initialsCorrect ? '✅ PASS' : '❌ FAIL'}\n`);
    if (!nameUpgraded || !initialsCorrect) allPassed = false;
  } catch (err: any) {
    console.error('   - Test 2 error:', err.message);
    allPassed = false;
  }

  // --------------------------------------------------------------------------
  // TEST 3: Duplicate Message Redelivery Atomicity ("No messages yet" Prevention)
  // --------------------------------------------------------------------------
  console.log('3. Testing Message-First Insert Atomicity & Duplicate Replay Safety...');
  try {
    const dupMsgId = `msg_dup_test_${Date.now()}`;
    const initialMsg: Message = {
      id: dupMsgId,
      chatId: JID_STANDARD,
      senderName: 'Sherpa Mingma',
      fromMe: false,
      text: 'First delivery of message',
      timestamp: Date.now(),
    };
    const res1 = await addMessage(initialMsg);

    // Replay identical provider_message_id (e.g. Baileys reconnect)
    const replayMsg: Message = {
      id: dupMsgId,
      chatId: JID_STANDARD,
      senderName: 'Sherpa Mingma',
      fromMe: false,
      text: 'Replayed delivery',
      timestamp: Date.now() + 10_000,
    };
    const res2 = await addMessage(replayMsg);

    const convos = await getConversations();
    const convo = convos.find(c => c.id.includes(PHONE) || c.name === 'Sherpa Mingma');
    const isTextPreserved = convo?.lastMessage.text === 'First delivery of message';
    const isDuplicateCaught = res2.duplicate === true;

    console.log(`   - Duplicate event detected: ${isDuplicateCaught ? '✅ (duplicate: true)' : '❌'}`);
    console.log(`   - Conversation last message text preserved: "${convo?.lastMessage.text}"`);
    console.log(`   - "No messages yet" Desync Prevented: ${isTextPreserved && isDuplicateCaught ? '✅ PASS' : '❌ FAIL'}\n`);
    if (!isTextPreserved || !isDuplicateCaught) allPassed = false;
  } catch (err: any) {
    console.error('   - Test 3 error:', err.message);
    allPassed = false;
  }

  // --------------------------------------------------------------------------
  // TEST 4: Ghost Contact Merge Stored Procedure
  // --------------------------------------------------------------------------
  console.log('4. Testing merge_duplicate_contacts_atomic Stored Procedure...');
  try {
    const mergeResult = await mergeDuplicateContacts();
    console.log(`   - Merge procedure executed: ${mergeResult.success ? '✅' : '❌'} (Merged groups: ${mergeResult.mergedGroups})`);
    console.log(`   - Contact Merge Stored Procedure: ${mergeResult.success ? '✅ PASS' : '❌ FAIL'}\n`);
    if (!mergeResult.success) allPassed = false;
  } catch (err: any) {
    console.error('   - Test 4 error:', err.message);
    allPassed = false;
  }

  // --------------------------------------------------------------------------
  // TEST 5: Manual @lid Contact Merge (Baileys cannot auto-resolve LID -> phone)
  // --------------------------------------------------------------------------
  console.log('5. Testing manual merge of an @lid contact into its phone-based duplicate...');
  try {
    const lidMsgText = 'Hello from my linked device identity';
    const lidMsg: Message = {
      id: `msg_lid_${Date.now()}`,
      chatId: JID_LID,
      senderName: 'Sherpa Mingma',
      fromMe: false,
      text: lidMsgText,
      timestamp: Date.now(),
    };
    await addMessage(lidMsg);

    const { data: lidChannel } = await sb
      .from('contact_channels')
      .select('contact_id, phone_number')
      .eq('external_id', JID_LID)
      .maybeSingle();

    const lidContactCreatedSeparately = !!lidChannel && lidChannel.phone_number === null;
    console.log(`   - @lid contact created with no phone_number: ${lidContactCreatedSeparately ? '✅' : '❌'}`);

    const mergeResult = await mergeContactByChatId(JID_LID, PHONE);
    console.log(`   - Manual merge executed: ${mergeResult.success ? '✅' : `❌ (${mergeResult.message})`}`);

    const { data: lidChannelAfter } = await sb
      .from('contact_channels')
      .select('contact_id')
      .eq('external_id', JID_LID)
      .maybeSingle();
    const { data: standardChannelAfter } = await sb
      .from('contact_channels')
      .select('contact_id')
      .eq('external_id', JID_STANDARD)
      .maybeSingle();

    const resolvedToSameContact =
      !!lidChannelAfter && !!standardChannelAfter && lidChannelAfter.contact_id === standardChannelAfter.contact_id;

    const messagesAfterMerge = await getMessages(JID_STANDARD);
    const historyPreserved = messagesAfterMerge.some(m => m.text === lidMsgText);

    console.log(`   - @lid and phone-based JID now resolve to same contact: ${resolvedToSameContact ? '✅' : '❌'}`);
    console.log(`   - LID conversation message history preserved on merge: ${historyPreserved ? '✅' : '❌'}`);
    console.log(`   - Manual LID Reconciliation: ${lidContactCreatedSeparately && mergeResult.success && resolvedToSameContact && historyPreserved ? '✅ PASS' : '❌ FAIL'}\n`);
    if (!lidContactCreatedSeparately || !mergeResult.success || !resolvedToSameContact || !historyPreserved) allPassed = false;
  } catch (err: any) {
    console.error('   - Test 5 error:', err.message);
    allPassed = false;
  }

  // Cleanup test contact
  const { data: cc } = await sb.from('contact_channels').select('contact_id').eq('external_id', JID_STANDARD).maybeSingle();
  if (cc?.contact_id) {
    await sb.from('contacts').delete().eq('id', cc.contact_id);
  }

  console.log('============================================================');
  console.log(`  FINAL RESULT: ${allPassed ? '🎉 ALL CONTACT DEDUP & SYNC TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('============================================================\n');

  return allPassed;
}

if (process.argv[1]?.includes('contact_dedup_and_jid_reconciliation.test.ts') || process.argv[1]?.includes('contact_dedup_and_jid_reconciliation.test')) {
  runContactDedupAndJidReconciliationTestSuite().then(ok => {
    process.exit(ok ? 0 : 1);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
