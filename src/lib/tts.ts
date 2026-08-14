/**
 * Text-to-Speech (TTS) Synthesis Module
 * Supports multilingual audio generation using Google Web TTS (zero key required),
 * OpenAI TTS, or ElevenLabs for WhatsApp Voice Notes.
 */

export interface TTSOptions {
  lang?: string; // 'en', 'ne', 'hi', 'es', etc.
  voice?: string; // e.g. 'alloy', 'nova', 'echo' for OpenAI
  provider?: 'google' | 'openai' | 'elevenlabs';
}

/**
 * Detects the best language code for speech synthesis.
 */
function detectLanguage(text: string): string {
  // Check for Devanagari script (Nepali / Hindi)
  if (/[\u0900-\u097F]/.test(text)) {
    return 'ne';
  }
  // Check for common Romanized Nepali phrases/tokens
  const lower = text.toLowerCase();
  if (/\b(namaste|dhanyabad|mero|tapai|tapaiko|hajur|cha|chaina|garnu|bhayo)\b/.test(lower)) {
    return 'ne';
  }
  return 'en';
}

/**
 * Splits text into small chunks suitable for the Google TTS endpoint (<= 180 chars per chunk).
 */
function splitTextForGoogleTTS(text: string, maxLen = 180): string[] {
  const clean = text
    .replace(/[*_~`#\[\]]/g, '') // remove markdown artifacts
    .replace(/\s+/g, ' ')
    .trim();

  if (clean.length <= maxLen) return [clean];

  const sentences = clean.split(/(?<=[.?!।,\n])\s+/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + ' ' + sentence).trim().length <= maxLen) {
      currentChunk = (currentChunk + ' ' + sentence).trim();
    } else {
      if (currentChunk) chunks.push(currentChunk);
      if (sentence.length > maxLen) {
        // Break long sentence by space
        const words = sentence.split(' ');
        let wordChunk = '';
        for (const w of words) {
          if ((wordChunk + ' ' + w).trim().length <= maxLen) {
            wordChunk = (wordChunk + ' ' + w).trim();
          } else {
            if (wordChunk) chunks.push(wordChunk);
            wordChunk = w;
          }
        }
        currentChunk = wordChunk;
      } else {
        currentChunk = sentence;
      }
    }
  }
  if (currentChunk) chunks.push(currentChunk);

  return chunks.filter(c => c.length > 0);
}

/**
 * Generates MP3 audio buffer using Google Web TTS.
 */
async function generateGoogleTTS(text: string, lang: string): Promise<Buffer> {
  const chunks = splitTextForGoogleTTS(text);
  const buffers: Buffer[] = [];

  for (const chunk of chunks) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${lang}&client=tw-ob`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://translate.google.com/',
      },
    });

    if (!res.ok) {
      throw new Error(`Google TTS request failed with status ${res.status}: ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    buffers.push(Buffer.from(arrayBuffer));
  }

  return Buffer.concat(buffers);
}

/**
 * Generates MP3 audio buffer using OpenAI TTS API.
 */
async function generateOpenAITTS(text: string, apiKey: string, voice = 'alloy'): Promise<Buffer> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'tts-1',
      voice: voice,
      input: text.slice(0, 4000),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI TTS Error: ${err}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Main Text-to-Speech generation function.
 * Returns an audio Buffer formatted as MP3 (compatible with WhatsApp audio/mp4 / ptt).
 */
export async function generateSpeechAudio(text: string, options?: TTSOptions): Promise<Buffer> {
  const lang = options?.lang || detectLanguage(text);
  const provider = options?.provider || 'google';

  const openaiKey = process.env.OPENAI_API_KEY;

  if (provider === 'openai' && openaiKey) {
    try {
      return await generateOpenAITTS(text, openaiKey, options?.voice);
    } catch (err) {
      console.warn('OpenAI TTS failed, falling back to Google TTS:', (err as Error).message);
    }
  }

  // Default to robust Google Multilingual TTS
  return await generateGoogleTTS(text, lang);
}
