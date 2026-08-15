import 'dotenv/config';
import { generateAIResponse, clearProviderCooldowns } from '../../src/lib/ai';
import {
  getConversations,
  updateConversation,
  setConversationTakeover,
  addMessage,
} from '../../src/lib/db';
import { isConversationPaused } from '../../src/lib/whatsapp-client';
import { getSupabaseAdmin } from '../../src/lib/supabase';
import type { AISettings, Message } from '../../src/types';

export async function runAIFailureAndTakeoverRaceTestSuite(): Promise<boolean> {
  console.log('============================================================');
  console.log('  AI FAILURE RESILIENCE & HUMAN TAKEOVER RACE TEST SUITE');
  console.log('============================================================\n');

  let allPassed = true;
  const sb = getSupabaseAdmin();
  const originalFetch = global.fetch;

  // Base AI settings for tests
  const baseSettings: AISettings = {
    provider: 'gemini',
    systemPrompt: 'You are a helpful customer support agent for AIWhisper.',
    maxLen: 200,
    temperature: 0.7,
    knowledgeFileIds: [],
  };

  // --------------------------------------------------------------------------
  // TEST 1: Gemini 429 Rate Limit & Failover
  // --------------------------------------------------------------------------
  console.log('1. Testing Gemini 429 (Rate Limit) & Fallback Recovery...');
  clearProviderCooldowns();
  try {
    let intercepted429 = false;
    global.fetch = async (url: any, opts: any) => {
      const urlStr = String(url);
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        intercepted429 = true;
        return new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: 'Resource has been exhausted (e.g. check quota).',
              status: 'RESOURCE_EXHAUSTED',
            },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(url, opts);
    };

    const response = await generateAIResponse('Hello, are you available?', baseSettings);
    const recovered = Boolean(response && response.length > 0 && intercepted429);
    console.log(`   - 429 Intercepted: ${intercepted429 ? '✅' : '❌'}`);
    console.log(`   - Failover Recovery Response: "${response?.slice(0, 60)}..."`);
    console.log(`   - Gemini 429 Resilience: ${recovered ? '✅ PASS' : '❌ FAIL'}\n`);
    if (!recovered) allPassed = false;
  } catch (err: any) {
    console.error('   - Gemini 429 test error:', err.message);
    allPassed = false;
  } finally {
    global.fetch = originalFetch;
  }

  // --------------------------------------------------------------------------
  // TEST 2: Gemini Timeout
  // --------------------------------------------------------------------------
  console.log('2. Testing Gemini Upstream Timeout Handling & Model Failover...');
  clearProviderCooldowns();
  try {
    let timeoutTriggered = false;
    global.fetch = async (url: any, opts: any) => {
      const urlStr = String(url);
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        timeoutTriggered = true;
        const abortErr = new Error('The operation was aborted due to timeout');
        abortErr.name = 'TimeoutError';
        throw abortErr;
      }
      return originalFetch(url, opts);
    };

    const response = await generateAIResponse('What are your business hours?', baseSettings);
    const timeoutHandled = Boolean(response && response.length > 0 && timeoutTriggered);
    console.log(`   - Timeout Simulated: ${timeoutTriggered ? '✅' : '❌'}`);
    console.log(`   - Failover Provider Output: "${response?.slice(0, 60)}..."`);
    console.log(`   - Gemini Timeout Recovery: ${timeoutHandled ? '✅ PASS' : '❌ FAIL'}\n`);
    if (!timeoutHandled) allPassed = false;
  } catch (err: any) {
    console.error('   - Gemini timeout test error:', err.message);
    allPassed = false;
  } finally {
    global.fetch = originalFetch;
  }

  // --------------------------------------------------------------------------
  // TEST 3: Gemini 5xx Internal Server Error
  // --------------------------------------------------------------------------
  console.log('3. Testing Gemini 5xx (503 Service Unavailable) Failover...');
  clearProviderCooldowns();
  try {
    let serverErrorTriggered = false;
    global.fetch = async (url: any, opts: any) => {
      const urlStr = String(url);
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        serverErrorTriggered = true;
        return new Response(
          JSON.stringify({
            error: {
              code: 503,
              message: 'The model is currently overloaded. Please try again later.',
              status: 'UNAVAILABLE',
            },
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(url, opts);
    };

    const response = await generateAIResponse('Tell me about your plans.', baseSettings);
    const recovered5xx = Boolean(response && response.length > 0 && serverErrorTriggered);
    console.log(`   - 503 Error Simulated: ${serverErrorTriggered ? '✅' : '❌'}`);
    console.log(`   - Failover Recovery Output: "${response?.slice(0, 60)}..."`);
    console.log(`   - Gemini 5xx Resilience: ${recovered5xx ? '✅ PASS' : '❌ FAIL'}\n`);
    if (!recovered5xx) allPassed = false;
  } catch (err: any) {
    console.error('   - Gemini 5xx test error:', err.message);
    allPassed = false;
  } finally {
    global.fetch = originalFetch;
  }

  // --------------------------------------------------------------------------
  // TEST 4: Invalid API Key Isolation
  // --------------------------------------------------------------------------
  console.log('4. Testing Invalid API Key Isolation & Error Capture...');
  clearProviderCooldowns();
  try {
    let caughtExpectedError = false;
    try {
      await generateAIResponse('test message', {
        ...baseSettings,
        provider: 'gemini',
        apiKey: 'INVALID_AI_KEY_TEST_XYZ_12345',
      });
    } catch (err: any) {
      caughtExpectedError = true;
      console.log(`   - Captured expected API key error: "${err.message?.slice(0, 65)}..."`);
    }

    console.log(`   - Invalid Key Safety: ${caughtExpectedError ? '✅ PASS' : '❌ FAIL'}\n`);
    if (!caughtExpectedError) allPassed = false;
  } catch (err: any) {
    console.error('   - Invalid key test error:', err.message);
    allPassed = false;
  }

  // --------------------------------------------------------------------------
  // TEST 5: Complete Provider Unavailability (Network Failure)
  // --------------------------------------------------------------------------
  console.log('5. Testing Provider Network Unavailability (ECONNREFUSED)...');
  clearProviderCooldowns();
  try {
    let networkErrorSimulated = false;
    global.fetch = async (url: any, opts: any) => {
      const urlStr = String(url);
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        networkErrorSimulated = true;
        throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:443');
      }
      return originalFetch(url, opts);
    };

    const response = await generateAIResponse('Do you offer support on weekends?', baseSettings);
    const networkRecovered = Boolean(response && response.length > 0 && networkErrorSimulated);
    console.log(`   - Network Outage Simulated: ${networkErrorSimulated ? '✅' : '❌'}`);
    console.log(`   - Secondary Provider Recovered: "${response?.slice(0, 60)}..."`);
    console.log(`   - Network Outage Resilience: ${networkRecovered ? '✅ PASS' : '❌ FAIL'}\n`);
    if (!networkRecovered) allPassed = false;
  } catch (err: any) {
    console.error('   - Network unavailability test error:', err.message);
    allPassed = false;
  } finally {
    global.fetch = originalFetch;
  }

  // --------------------------------------------------------------------------
  // TEST 6: Verify AI Failure Does Not Create Duplicate/Phantom DB Records
  // --------------------------------------------------------------------------
  console.log('6. Testing AI Failure DB Message Integrity & Anti-Duplication...');
  clearProviderCooldowns();
  const testChatId = 'test_failure_integrity@s.whatsapp.net';
  try {
    // 1. Send customer inbound message
    const inboundMsg: Message = {
      id: `msg_inbound_${Date.now()}`,
      chatId: testChatId,
      senderName: 'Test Integrity User',
      fromMe: false,
      text: 'Need immediate help',
      timestamp: Date.now(),
    };
    await addMessage(inboundMsg);

    // 2. Simulate complete failure during AI generation
    let aiFailed = false;
    try {
      global.fetch = async (url: any, opts: any) => {
        const urlStr = String(url);
        // Only fail LLM API calls, let DB fetch go through
        if (urlStr.includes('googleapis.com') || urlStr.includes('groq.com') || urlStr.includes('openai.com') || urlStr.includes('anthropic.com')) {
          throw new Error('Total catastrophic LLM outage');
        }
        return originalFetch(url, opts);
      };

      await generateAIResponse('Need immediate help', {
        ...baseSettings,
        apiKey: 'FORCE_FAIL_KEY',
      });
    } catch (_) {
      aiFailed = true;
    } finally {
      global.fetch = originalFetch;
    }

    // 3. Query DB messages for this chat
    const convos = await getConversations();
    const targetConvo = convos.find(c => c.id === testChatId);
    const { data: dbMessages } = await sb
      .from('messages')
      .select('*')
      .eq('sender_type', 'user')
      .ilike('metadata->>chatId', testChatId);

    const noPhantomMessages = (dbMessages?.length || 0) === 0;
    console.log(`   - AI Generation Failed Gracefully: ${aiFailed ? '✅' : '❌'}`);
    console.log(`   - Phantom Outbound Messages in DB: ${dbMessages?.length || 0} (Expected 0)`);
    console.log(`   - AI Failure DB Cleanliness: ${noPhantomMessages ? '✅ PASS' : '❌ FAIL'}\n`);
    if (!noPhantomMessages || !aiFailed) allPassed = false;

    // Cleanup
    const { data: cc } = await sb.from('contact_channels').select('contact_id').eq('external_id', testChatId).maybeSingle();
    if (cc?.contact_id) {
      await sb.from('contacts').delete().eq('id', cc.contact_id);
    }
  } catch (err: any) {
    console.error('   - DB integrity test error:', err.message);
    allPassed = false;
  }

  // --------------------------------------------------------------------------
  // TEST 7: Human Takeover Concurrency Race
  // (Customer message -> AI starts generating -> Human takes over -> AI aborted)
  // --------------------------------------------------------------------------
  console.log('7. Testing Human Takeover Concurrency Race (Customer -> AI Gen -> Human Takeover -> AI Abort)...');
  const raceChatId = 'test_human_race_condition@s.whatsapp.net';
  try {
    // Step 1: Customer message arrives, conversation is unpaused
    await updateConversation(raceChatId, {
      name: 'Race Condition Customer',
      isBotPaused: false,
      lastMessage: { text: 'I need pricing right now', timestamp: Date.now() },
    });

    console.log('   - Step 1: Customer message arrived. isBotPaused = false.');

    // Step 2: Simulate slow AI generation task (400ms delay)
    let aiGenerationDispatched = false;
    let aiOutboundSent = false;

    const slowAiPipeline = async () => {
      aiGenerationDispatched = true;
      // Simulate 400ms LLM + TTS latency
      await new Promise(r => setTimeout(r, 400));

      // AI finishes text generation:
      const generatedText = 'Here is our pricing structure: $29/month.';

      // Pre-send double guard: Check latest live DB state immediately before socket dispatch
      const currentConvo = await getConversations().then(cs => cs.find(c => c.id === raceChatId));
      if (isConversationPaused(currentConvo)) {
        console.log('   - Step 4 (AI Pipeline): Pre-send guard TRIGGERED -> Aborting outbound AI dispatch!');
        return; // ABORT SEND
      }

      // If guard didn't catch it, it would have sent
      aiOutboundSent = true;
    };

    // Launch AI background generation
    const aiPromise = slowAiPipeline();

    // Step 3: Mid-flight (at 100ms), Human operator takes over and replies
    await new Promise(r => setTimeout(r, 100));
    console.log('   - Step 2: Human Operator clicks "Take Over" & replies from inbox...');
    await setConversationTakeover(raceChatId, true, 'operator_user_1', 'Operator manual intervention');

    // Wait for AI generation pipeline to complete
    await aiPromise;

    // Step 5: Assert AI outbound send was dropped
    const finalConvo = await getConversations().then(cs => cs.find(c => c.id === raceChatId));
    const racePassed = finalConvo?.isBotPaused === true && !aiOutboundSent && aiGenerationDispatched;

    console.log(`   - AI Generation Ran: ${aiGenerationDispatched ? '✅' : '❌'}`);
    console.log(`   - AI Outbound Socket Send Prevented: ${!aiOutboundSent ? '✅ BLOCKED' : '❌ SENT PHANTOM'}`);
    console.log(`   - Final Conversation State: isBotPaused = ${finalConvo?.isBotPaused}`);
    console.log(`   - Human Takeover Race Guard: ${racePassed ? '✅ PASS' : '❌ FAIL'}\n`);
    if (!racePassed) allPassed = false;

    // Cleanup
    const { data: cc } = await sb.from('contact_channels').select('contact_id').eq('external_id', raceChatId).maybeSingle();
    if (cc?.contact_id) {
      await sb.from('contacts').delete().eq('id', cc.contact_id);
    }
  } catch (err: any) {
    console.error('   - Human takeover race test error:', err.message);
    allPassed = false;
  }

  console.log('============================================================');
  console.log(`  FINAL RESULT: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('============================================================\n');

  return allPassed;
}

if (process.argv[1]?.includes('ai_failure_and_takeover_races.test.ts') || process.argv[1]?.includes('ai_failure_and_takeover_races.test')) {
  runAIFailureAndTakeoverRaceTestSuite().then(ok => {
    process.exit(ok ? 0 : 1);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
