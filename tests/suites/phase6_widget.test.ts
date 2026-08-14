import 'dotenv/config';
import {
  getWidgetConfig,
  updateWidgetConfig,
  getConversation,
  getMessages,
  addMessage,
  updateConversation,
  setConversationTakeover,
} from '../../src/lib/db';
import type { Message, WidgetConfig } from '../../src/types';

export async function runPhase6TestSuite(): Promise<boolean> {
  console.log('\n============================================================');
  console.log('  PHASE B: EMBEDDABLE LIVE WEB CHAT WIDGET TEST SUITE');
  console.log('============================================================\n');

  let allPassed = true;
  const testSessionId = `visitor_test_${Date.now()}`;
  const testChatId = `${testSessionId}@webchat`;

  // Test 1: Widget Configuration Management
  console.log('1. Testing Widget Configuration Management in Database...');
  try {
    const originalConfig = await getWidgetConfig();
    console.log(`   - Default Widget Title: "${originalConfig.title}" (Color: ${originalConfig.primaryColor})`);

    const updatedConfig = await updateWidgetConfig({
      title: 'Enterprise Live Concierge',
      primaryColor: '#8B5CF6',
      greeting: 'Welcome to Enterprise Support! How can we assist you today?',
    });

    console.log(`   - Updated Widget Title: "${updatedConfig.title}" (Color: ${updatedConfig.primaryColor})`);

    const configMatch =
      updatedConfig.title === 'Enterprise Live Concierge' &&
      updatedConfig.primaryColor === '#8B5CF6';

    if (configMatch) {
      console.log('   - Widget Configuration CRUD: ✅ PASS');
    } else {
      console.log('   - Widget Configuration CRUD: ❌ FAIL');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Widget config error:', err);
    allPassed = false;
  }

  // Test 2: Web Chat Message Ingestion & Channel Unification
  console.log('\n2. Testing Web Chat Message Ingestion & Inbox Integration...');
  try {
    const visitorMsg: Message = {
      id: `web_test_${Date.now()}`,
      chatId: testChatId,
      fromMe: false,
      text: 'Hello, I have a question about setting up automated webhooks on the enterprise tier.',
      timestamp: Date.now(),
      senderName: 'Website Visitor',
    };

    await addMessage(visitorMsg);
    await updateConversation(testChatId, {
      name: 'Website Visitor',
      lastMessage: { text: visitorMsg.text, timestamp: visitorMsg.timestamp },
      incrementUnread: true,
    });

    const messages = await getMessages(testChatId);
    const convo = await getConversation(testChatId);

    console.log(`   - Ingested Messages in Session: ${messages.length}`);
    console.log(`   - Conversation in Inbox: "${convo?.name}" (ID: ${convo?.id})`);

    const messageMatch = messages.some(m => m.id === visitorMsg.id);
    const convoMatch = convo?.id === testChatId;

    if (messageMatch && convoMatch) {
      console.log('   - Web Chat Message Ingestion: ✅ PASS');
    } else {
      console.log('   - Web Chat Message Ingestion: ❌ FAIL');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Message ingestion error:', err);
    allPassed = false;
  }

  // Test 3: Takeover Mode on Web Chat Conversations
  console.log('\n3. Testing Human Agent Takeover Mode on Web Chat Channel...');
  try {
    await setConversationTakeover(testChatId, true, undefined, 'Live Agent Takeover on Web Chat');
    const convoAfterTakeover = await getConversation(testChatId);

    console.log(`   - Is Bot Paused: ${convoAfterTakeover?.isBotPaused ? 'YES' : 'NO'}`);
    console.log(`   - Handoff Reason: "${convoAfterTakeover?.handoffReason}"`);

    if (convoAfterTakeover?.isBotPaused) {
      console.log('   - Web Chat Live Takeover: ✅ PASS');
    } else {
      console.log('   - Web Chat Live Takeover: ❌ FAIL');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Takeover error:', err);
    allPassed = false;
  }

  console.log('\n============================================================');
  console.log(`  FINAL RESULT: ${allPassed ? '✅ ALL PHASE B TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('============================================================\n');

  return allPassed;
}

// Direct execution
if (require.main === module) {
  runPhase6TestSuite().then(passed => {
    process.exit(passed ? 0 : 1);
  });
}
