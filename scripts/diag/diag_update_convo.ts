import 'dotenv/config';
import { getSupabaseAdmin } from '../../src/lib/supabase';
import { updateConversation } from '../../src/lib/db';

async function diag2() {
  const sb = getSupabaseAdmin();
  const chatId = '9779800000000@s.whatsapp.net';
  console.log('Testing updateConversation directly...');

  await updateConversation(chatId, {
    name: 'TestUser',
    lastMessage: { text: 'Hello', timestamp: Date.now() },
    incrementUnread: true,
  });

  const { data: cc } = await sb.from('contact_channels').select('*').eq('external_id', chatId);
  console.log('contact_channels for chatId:', cc);

  const { data: convos } = await sb.from('conversations').select('*');
  console.log('conversations count:', convos?.length);
}

diag2().catch(console.error);
