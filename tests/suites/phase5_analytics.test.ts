import 'dotenv/config';
import {
  updateConversation,
  getConversation,
  addMessage,
  getSLAMetrics,
} from '../../src/lib/db';
import {
  analyzeMessageSentiment,
  generateConversationSummary,
} from '../../src/lib/ai-insights';
import type { Message } from '../../src/types';

export async function runPhase5TestSuite(): Promise<boolean> {
  console.log('\n============================================================');
  console.log('  PHASE A: AI SUMMARIES & SLA ANALYTICS TEST SUITE');
  console.log('============================================================\n');

  let allPassed = true;
  const testChatId = 'test_analytics_customer_8899@s.whatsapp.net';

  // Test 1: Message Sentiment Analysis (Heuristics & AI)
  console.log('1. Testing Sentiment Classification Engine...');
  try {
    const s1 = await analyzeMessageSentiment('I want to cancel my subscription immediately, this is terrible service!');
    const s2 = await analyzeMessageSentiment('Thank you so much! Everything works great now.');
    const s3 = await analyzeMessageSentiment('What are your business hours on weekends?');

    console.log(`   - "Cancel subscription immediately": ${s1} (Expected: "frustrated")`);
    console.log(`   - "Thank you so much": ${s2} (Expected: "positive")`);
    console.log(`   - "Business hours inquiry": ${s3} (Expected: "neutral")`);

    const sentimentPass = s1 === 'frustrated' && s2 === 'positive' && s3 === 'neutral';
    if (sentimentPass) {
      console.log('   - Sentiment Classification Engine: ✅ PASS');
    } else {
      console.log('   - Sentiment Classification Engine: ❌ FAIL');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Sentiment error:', err);
    allPassed = false;
  }

  // Test 2: AI Resolution Summary & 2-Bullet Format Generation
  console.log('\n2. Testing AI Conversation Summary Generation...');
  try {
    // Seed conversation messages
    const now = Date.now();
    await updateConversation(testChatId, {
      name: 'Eleanor Vance',
      status: 'open',
      firstResponseTimeMs: 12000, // 12 seconds FRT
    });

    const msg1: Message = {
      id: `msg_test_${Date.now()}_1`,
      chatId: testChatId,
      fromMe: false,
      text: 'Hi, I need help updating my billing credit card for the enterprise plan.',
      timestamp: now - 60000,
    };
    const msg2: Message = {
      id: `msg_test_${Date.now()}_2`,
      chatId: testChatId,
      fromMe: true,
      text: 'Hello Eleanor! I have sent a secure payment update link to your registered email address.',
      timestamp: now - 30000,
    };
    const msg3: Message = {
      id: `msg_test_${Date.now()}_3`,
      chatId: testChatId,
      fromMe: false,
      text: 'Card updated successfully, thanks for the fast support!',
      timestamp: now,
    };

    await addMessage(msg1);
    await addMessage(msg2);
    await addMessage(msg3);

    const summaryResult = await generateConversationSummary(testChatId);
    console.log(`   - Generated Summary:\n${summaryResult.summary}`);
    console.log(`   - Detected Sentiment: ${summaryResult.sentiment}`);
    console.log(`   - Suggested Tags: [${summaryResult.suggestedTags.join(', ')}]`);

    const hasBullets = summaryResult.summary.includes('•') && summaryResult.summary.split('•').length >= 3;
    const hasSentiment = ['positive', 'neutral', 'negative', 'frustrated'].includes(summaryResult.sentiment);

    if (hasBullets && hasSentiment) {
      console.log('   - AI Resolution Summary (2-Bullet Format): ✅ PASS');
    } else {
      console.log('   - AI Resolution Summary: ❌ FAIL');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Summary generation error:', err);
    allPassed = false;
  }

  // Test 3: Conversation Hydration with AI Summary & SLA Fields
  console.log('\n3. Testing Conversation Hydration with AI Summary & SLA Fields...');
  try {
    const convo = await getConversation(testChatId);
    console.log(`   - Hydrated AI Summary present: ${convo?.aiSummary ? 'YES' : 'NO'}`);
    console.log(`   - Hydrated Sentiment: ${convo?.sentiment}`);
    console.log(`   - Hydrated FRT: ${convo?.firstResponseTimeMs}ms`);
    console.log(`   - Hydrated Resolution Duration: ${convo?.resolutionDurationMs}ms`);

    const hydratePass =
      !!convo?.aiSummary &&
      convo?.sentiment === 'positive' &&
      convo?.firstResponseTimeMs === 12000 &&
      (convo?.resolutionDurationMs || 0) > 0;

    if (hydratePass) {
      console.log('   - Conversation Hydration (Summary & SLA): ✅ PASS');
    } else {
      console.log('   - Conversation Hydration: ❌ FAIL');
      allPassed = false;
    }
  } catch (err) {
    console.error('   - Hydration error:', err);
    allPassed = false;
  }

  // Test 4: SLA Metrics Aggregation & Leaderboards
  console.log('\n4. Testing SLA Metrics Aggregation & Agent Leaderboards...');
  try {
    const slaMetrics = await getSLAMetrics();
    console.log(`   - Total Resolved Conversations: ${slaMetrics.totalResolved}`);
    console.log(`   - Average First Response Time: ${slaMetrics.avgFirstResponseTimeMs}ms`);
    console.log(`   - Average Resolution Duration: ${slaMetrics.avgResolutionDurationMs}ms`);
    console.log(`   - Sentiment Breakdown:`, slaMetrics.sentimentBreakdown);
    console.log(`   - Agent Leaderboard Entries: ${slaMetrics.agentLeaderboard.length}`);

    const hasMetrics =
      slaMetrics.totalResolved >= 0 &&
      slaMetrics.sentimentBreakdown.positive >= 0 &&
      slaMetrics.sentimentBreakdown.neutral >= 0;

    if (hasMetrics) {
      console.log('   - SLA Metrics Aggregation: ✅ PASS');
    } else {
      console.log('   - SLA Metrics Aggregation: ❌ FAIL');
      allPassed = false;
    }

    // Cleanup test conversation & contact
    const sb = (await import('../../src/lib/supabase')).getSupabaseAdmin();
    const { data: cc } = await sb.from('contact_channels').select('contact_id').eq('external_id', testChatId).maybeSingle();
    if (cc?.contact_id) {
      await sb.from('contacts').delete().eq('id', cc.contact_id);
    }
  } catch (err) {
    console.error('   - SLA metrics error:', err);
    allPassed = false;
  }

  console.log('\n============================================================');
  console.log(`  FINAL RESULT: ${allPassed ? '✅ ALL PHASE A TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('============================================================\n');

  return allPassed;
}

// Direct execution
if (require.main === module) {
  runPhase5TestSuite().then(passed => {
    process.exit(passed ? 0 : 1);
  });
}
