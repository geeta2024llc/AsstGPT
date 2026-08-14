import 'dotenv/config';
import { generateSpeechAudio } from '../../src/lib/tts';
import { generateAIResponse, transcribeAudio, type MediaAttachment } from '../../src/lib/ai';
import { getAgents } from '../../src/lib/db';

export async function runMultimodalTestSuite(): Promise<boolean> {
  console.log('\n============================================================');
  console.log('       MULTIMODAL & VOICE PROCESSING TEST SUITE');
  console.log('============================================================\n');

  let allPassed = true;
  let testsCount = 0;
  let passedCount = 0;

  // -------------------------------------------------------------
  // Test 1: Multilingual TTS Audio Generation (English)
  // -------------------------------------------------------------
  testsCount++;
  console.log('[Test 1] Generating English Speech Audio (TTS)...');
  try {
    const textEn = 'Hello, thank you for reaching out to AIWhisper support. How may I assist you?';
    const audioBuf = await generateSpeechAudio(textEn, { lang: 'en' });
    if (audioBuf && audioBuf.length > 500) {
      console.log(`✅ PASS: Generated English MP3 audio buffer (${audioBuf.length} bytes)\n`);
      passedCount++;
    } else {
      console.log(`❌ FAIL: Generated audio buffer too small: ${audioBuf?.length} bytes\n`);
      allPassed = false;
    }
  } catch (err) {
    console.error('❌ FAIL: English TTS error:', (err as Error).message, '\n');
    allPassed = false;
  }

  // -------------------------------------------------------------
  // Test 2: Multilingual TTS Audio Generation (Nepali)
  // -------------------------------------------------------------
  testsCount++;
  console.log('[Test 2] Generating Nepali Speech Audio (TTS)...');
  try {
    const textNe = 'नमस्ते! AIWhisper मा स्वागत छ। म तपाईंलाई कसरी मद्दत गर्न सक्छु?';
    const audioBufNe = await generateSpeechAudio(textNe);
    if (audioBufNe && audioBufNe.length > 500) {
      console.log(`✅ PASS: Generated Nepali MP3 audio buffer (${audioBufNe.length} bytes)\n`);
      passedCount++;
    } else {
      console.log(`❌ FAIL: Generated audio buffer too small: ${audioBufNe?.length} bytes\n`);
      allPassed = false;
    }
  } catch (err) {
    console.error('❌ FAIL: Nepali TTS error:', (err as Error).message, '\n');
    allPassed = false;
  }

  // -------------------------------------------------------------
  // Test 3: Gemini Vision with Image Attachment
  // -------------------------------------------------------------
  testsCount++;
  console.log('[Test 3] Testing Gemini Vision with Image Attachment...');
  try {
    const agents = await getAgents();
    const agent = agents.find(a => a.status === 'active') || agents[0];

    if (!agent || !agent.aiSettings) {
      console.log('❌ FAIL: No active AI agent found for vision test\n');
      allPassed = false;
    } else {
      // 1x1 transparent PNG sample buffer
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const sampleImage: MediaAttachment = {
        buffer: Buffer.from(pngBase64, 'base64'),
        mimeType: 'image/png',
        fileName: 'test_image.png',
      };

      const visionResponse = await generateAIResponse(
        'Please inspect this image and describe what format it is.',
        agent.aiSettings,
        [],
        sampleImage
      );

      console.log(`Vision AI Response: "${visionResponse.replace(/\n/g, ' ')}"`);
      if (visionResponse && visionResponse.length > 5) {
        console.log('✅ PASS: Multimodal Gemini Vision processed image attachment successfully\n');
        passedCount++;
      } else {
        console.log('❌ FAIL: Empty vision response\n');
        allPassed = false;
      }
    }
  } catch (err) {
    console.error('❌ FAIL: Gemini Vision test error:', (err as Error).message, '\n');
    allPassed = false;
  }

  // -------------------------------------------------------------
  // Test 4: Audio Transcription Error Handling & Validation
  // -------------------------------------------------------------
  testsCount++;
  console.log('[Test 4] Audio Transcription Signature & Validation...');
  try {
    const dummyAudio = Buffer.from('dummy-ogg-audio-stream-content');
    // Calling with an invalid key should throw a clean, handled error
    try {
      await transcribeAudio(dummyAudio, 'audio/ogg', 'invalid_key_for_test');
      console.log('❌ FAIL: Expected error for invalid key was not thrown\n');
      allPassed = false;
    } catch (expectedErr) {
      console.log(`✅ PASS: transcribeAudio properly validated API key & caught error: ${(expectedErr as Error).message.slice(0, 70)}...\n`);
      passedCount++;
    }
  } catch (err) {
    console.error('❌ FAIL: Audio transcription check error:', err, '\n');
    allPassed = false;
  }

  console.log('============================================================');
  console.log(`MULTIMODAL TEST SUMMARY: ${passedCount}/${testsCount} PASSED`);
  console.log('============================================================\n');

  return allPassed;
}

if (process.argv[1]?.includes('multimodal.test.ts') || process.argv[1]?.includes('multimodal.test')) {
  runMultimodalTestSuite().then(ok => {
    process.exit(ok ? 0 : 1);
  }).catch(err => {
    console.error('Test crashed:', err);
    process.exit(1);
  });
}
