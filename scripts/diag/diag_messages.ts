import 'dotenv/config';
import { getSupabaseAdmin } from '../../src/lib/supabase';
import { addMessage, getMessages } from '../../src/lib/db';

async function diag() {
  const sb = getSupabaseAdmin();
  console.log('--- DIAGNOSTIC FOR MESSAGES TABLE ---');

  // 1. Direct admin query
  const { data: allMsgs, error: err1 } = await sb.from('messages').select('*');
  console.log('Admin messages count:', allMsgs?.length, 'error:', err1);

  // 2. Test inserting a dummy test message
  const testMsg = {
    id: `test_msg_${Date.now()}`,
    chatId: '9779800000000@s.whatsapp.net',
    fromMe: false,
    text: 'Diagnostic test message',
    timestamp: Date.now(),
    senderName: 'TestUser',
  };

  console.log('Calling addMessage()...');
  const res = await addMessage(testMsg);
  console.log('addMessage result:', res);

  // 3. Re-query admin messages count
  const { data: msgsAfter, error: err2 } = await sb.from('messages').select('*');
  console.log('Messages count after insert:', msgsAfter?.length, 'error:', err2);
  if (msgsAfter?.length) {
    console.log('Inserted message sample:', msgsAfter[msgsAfter.length - 1]);
  }

  // Clean up test message
  if (res.success) {
    await sb.from('messages').delete().eq('provider_message_id', testMsg.id);
    console.log('Cleaned up test message.');
  }
}

diag().catch(console.error);
