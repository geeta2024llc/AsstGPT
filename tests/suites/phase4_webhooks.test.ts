import 'dotenv/config';
import http from 'http';
import {
  createWebhook,
  getWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
} from '../../src/lib/db';
import { dispatchWebhookEvent, signWebhookPayload } from '../../src/lib/webhook-dispatcher';
import type { WebhookEventType } from '../../src/types';

export async function runPhase4TestSuite(): Promise<boolean> {
  console.log('\n============================================================');
  console.log('  PHASE 4: OUTBOUND WEBHOOKS & CRM INTEGRATION TEST SUITE');
  console.log('============================================================\n');

  let allPassed = true;
  const testSecret = 'whsec_test_secret_key_123456789';
  const receivedRequests: any[] = [];

  // Step 0: Start a temporary local HTTP server to receive webhook dispatches
  const localPort = 9876;
  const localWebhookUrl = `http://127.0.0.1:${localPort}/webhook`;

  const mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const eventHeader = req.headers['x-aiwhisper-event'];
      const signatureHeader = req.headers['x-aiwhisper-signature'];
      const timestampHeader = req.headers['x-aiwhisper-timestamp'];

      receivedRequests.push({
        event: eventHeader,
        signature: signatureHeader,
        timestamp: timestampHeader,
        body: JSON.parse(body),
        rawBody: body,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true, timestamp: Date.now() }));
    });
  });

  await new Promise<void>(resolve => mockServer.listen(localPort, '127.0.0.1', () => resolve()));
  console.log(`0. Started mock webhook receiver server at ${localWebhookUrl}`);

  try {
    // Test 1: Webhook HMAC Signature Calculation
    console.log('\n1. Testing HMAC-SHA256 Signature Generation & Verification...');
    const samplePayload = JSON.stringify({ hello: 'world', count: 42 });
    const computedSignature = signWebhookPayload(samplePayload, testSecret);
    const recomputedSignature = signWebhookPayload(samplePayload, testSecret);

    console.log(`   - Generated Signature: sha256=${computedSignature.slice(0, 20)}...`);
    if (computedSignature && computedSignature === recomputedSignature) {
      console.log('   - HMAC Signature Consistency: ✅ PASS');
    } else {
      console.log('   - HMAC Signature Consistency: ❌ FAIL');
      allPassed = false;
    }

    // Test 2: Webhook CRUD Operations in Supabase
    console.log('\n2. Testing Webhook CRUD Operations in Supabase...');
    const created = await createWebhook({
      name: 'Zapier Integration Test',
      url: localWebhookUrl,
      secret: testSecret,
      events: ['handoff.triggered', 'contact.stage_changed'] as WebhookEventType[],
      isActive: true,
    });

    console.log(`   - Created Webhook ID: ${created.id} (Name: "${created.name}")`);
    const fetched = await getWebhook(created.id);
    const nameMatch = fetched?.name === 'Zapier Integration Test';
    const eventMatch = fetched?.events.includes('handoff.triggered') && fetched?.events.includes('contact.stage_changed');

    if (nameMatch && eventMatch) {
      console.log('   - Webhook Creation & Retrieval: ✅ PASS');
    } else {
      console.log('   - Webhook Creation & Retrieval: ❌ FAIL');
      allPassed = false;
    }

    // Test 3: Webhook Event Dispatching & HTTP Delivery
    console.log('\n3. Testing Webhook Dispatch Engine & Event Delivery...');
    const dispatchResult = await dispatchWebhookEvent('handoff.triggered', {
      chatId: 'test_user_escalated@s.whatsapp.net',
      ruleName: 'VIP Escalation Rule',
      reason: 'Customer requested human agent assistance.',
      assignedUserId: 'agent-sarah',
    });

    console.log(`   - Dispatch Result: ${dispatchResult.successful} success, ${dispatchResult.failed} failed (Matched: ${dispatchResult.totalMatched})`);

    // Give server a moment to complete parsing
    await new Promise(r => setTimeout(r, 300));

    const received = receivedRequests.find(r => r.event === 'handoff.triggered');
    if (received) {
      console.log(`   - Mock Receiver received event: "${received.event}"`);
      console.log(`   - Validating HMAC Signature: ${received.signature}`);

      const expectedSignature = `sha256=${signWebhookPayload(received.rawBody, testSecret)}`;
      const isSignatureValid = received.signature === expectedSignature;

      if (isSignatureValid && received.body.data.reason === 'Customer requested human agent assistance.') {
        console.log('   - Webhook Delivery & HMAC Verification: ✅ PASS');
      } else {
        console.log(`   - Webhook Delivery & HMAC Verification: ❌ FAIL (Expected ${expectedSignature}, got ${received.signature})`);
        allPassed = false;
      }
    } else {
      console.log('   - Webhook Delivery & HMAC Verification: ❌ FAIL (No request received)');
      allPassed = false;
    }

    // Test 4: Event Filtering (Unsubscribed Event should be skipped)
    console.log('\n4. Testing Event Filtering (Unsubscribed Event)...');
    receivedRequests.length = 0; // reset
    const unsubscribedDispatch = await dispatchWebhookEvent('note.created', {
      chatId: 'test_user@s.whatsapp.net',
      note: { content: 'Secret internal note' },
    });

    console.log(`   - Dispatch for unsubscribed event "note.created": matched ${unsubscribedDispatch.totalMatched} endpoints`);
    if (receivedRequests.length === 0) {
      console.log('   - Event Filtering (Unsubscribed Event Ignored): ✅ PASS');
    } else {
      console.log('   - Event Filtering (Unsubscribed Event Ignored): ❌ FAIL');
      allPassed = false;
    }

    // Test 5: Delivery Stats Recording in Supabase
    console.log('\n5. Testing Webhook Delivery Status Recording...');
    const refreshedWebhook = await getWebhook(created.id);
    console.log(`   - Last Status Code: HTTP ${refreshedWebhook?.lastStatusCode} (Last Triggered: ${refreshedWebhook?.lastTriggeredAt ? 'YES' : 'NO'})`);

    if (refreshedWebhook?.lastStatusCode === 200 && refreshedWebhook?.lastTriggeredAt) {
      console.log('   - Delivery Status Recording: ✅ PASS');
    } else {
      console.log('   - Delivery Status Recording: ❌ FAIL');
      allPassed = false;
    }

    // Cleanup: Delete created webhook
    console.log('\n6. Cleaning up Test Webhook...');
    await deleteWebhook(created.id);
    const afterDelete = await getWebhook(created.id);
    if (!afterDelete) {
      console.log('   - Webhook Cleanup: ✅ PASS');
    } else {
      console.log('   - Webhook Cleanup: ❌ FAIL');
      allPassed = false;
    }
  } finally {
    mockServer.close();
    console.log('   - Closed mock webhook server.');
  }

  console.log('\n============================================================');
  console.log(`  FINAL RESULT: ${allPassed ? '✅ ALL PHASE 4 TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('============================================================\n');

  return allPassed;
}

// Direct execution
if (require.main === module) {
  runPhase4TestSuite().then(passed => {
    process.exit(passed ? 0 : 1);
  });
}
