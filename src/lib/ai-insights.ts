import * as db from './db';
import type { SentimentType } from '@/types';

function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY || null;
}

/**
 * Lightweight sentiment analysis for incoming customer messages.
 */
export async function analyzeMessageSentiment(
  messageText: string,
  recentHistory: { fromMe: boolean; text: string }[] = []
): Promise<SentimentType> {
  const text = messageText.toLowerCase();

  // Fast heuristic regex for urgent frustration or delight
  const frustrationPatterns = [
    /cancel (my |the )?(subscription|account|plan|service)/,
    /refund (now|immediately|my money)/,
    /unacceptable|terrible|horrible|useless|scam|worst|lawyer|sue/,
    /angry|furious|annoyed|disgusted|ridiculous/,
    /broken|never works|waste of (time|money)/,
    /\b(wtf|damn|shitty)\b/,
  ];

  const positivePatterns = [
    /thank(s| you)? (so much|very much|a lot|for the)/,
    /amazing|awesome|wonderful|fantastic|perfect|great job|loved it/,
    /resolved|fixed|works (now|great|fine)/,
    /appreciate (your|the) (help|support)/,
  ];

  for (const pattern of frustrationPatterns) {
    if (pattern.test(text)) return 'frustrated';
  }

  for (const pattern of positivePatterns) {
    if (pattern.test(text)) return 'positive';
  }

  // If text is short or standard inquiry, treat as neutral
  if (text.length < 40) return 'neutral';

  const apiKey = getGeminiApiKey();
  if (!apiKey) return 'neutral';

  const candidateModels = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];

  for (const model of candidateModels) {
    try {
      const prompt = `Classify the sentiment of this customer message into strictly ONE word from: [positive, neutral, negative, frustrated].
Customer message: "${messageText}"
Respond only with the single classification word.`;

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 20 },
          }),
          signal: AbortSignal.timeout(4000),
        }
      );

      if (resp.ok) {
        const data = await resp.json();
        if (data.error) continue;
        const result = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().toLowerCase();
        if (['positive', 'neutral', 'negative', 'frustrated'].includes(result)) {
          return result as SentimentType;
        }
      }
    } catch (err) {
      // Graceful fallback to next model
    }
  }

  return 'neutral';
}

/**
 * Generates an automated 2-bullet AI summary and suggested CRM tags upon conversation resolution.
 */
export async function generateConversationSummary(chatId: string): Promise<{
  summary: string;
  suggestedTags: string[];
  sentiment: SentimentType;
}> {
  try {
    const messages = await db.getMessages(chatId);
    if (!messages || messages.length === 0) {
      return {
        summary: '• Conversation resolved with no recorded messages.\n• No customer action required.',
        suggestedTags: [],
        sentiment: 'neutral',
      };
    }

    const transcript = messages
      .slice(-15) // last 15 messages
      .map(m => `${m.fromMe ? 'Agent/Bot' : 'Customer'}: ${m.text}`)
      .join('\n');

    const apiKey = getGeminiApiKey();
    let summaryText = '';
    let sentiment: SentimentType = 'neutral';
    let suggestedTags: string[] = [];

    if (apiKey) {
      const prompt = `You are an expert customer operations AI analyst.
Analyze the following customer support conversation transcript and generate a structured resolution summary.

Conversation Transcript:
${transcript}

Instructions:
1. Provide a concise summary in EXACTLY 2 bullet points (starting with •). Bullet 1 must state the customer inquiry/problem. Bullet 2 must state the resolution or outcome.
2. Determine overall conversation sentiment: positive, neutral, negative, or frustrated.
3. Suggest 1 to 3 short CRM tags for this customer (e.g., "Billing", "Technical Support", "Feature Request", "Renewal").

Return strictly valid JSON format matching:
{
  "bullet1": "Customer inquired about...",
  "bullet2": "Agent resolved by...",
  "sentiment": "positive",
  "suggestedTags": ["Tag1", "Tag2"]
}`;

      const candidateModels = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];
      for (const model of candidateModels) {
        try {
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: 0.2,
                  responseMimeType: 'application/json',
                },
              }),
              signal: AbortSignal.timeout(6000),
            }
          );

          if (resp.ok) {
            const data = await resp.json();
            if (data.error) continue;
            const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            const parsed = JSON.parse(jsonText);
            const b1 = parsed.bullet1 || 'Customer inquiry addressed.';
            const b2 = parsed.bullet2 || 'Conversation marked as resolved.';
            summaryText = `• ${b1.replace(/^[•\s-]+/, '')}\n• ${b2.replace(/^[•\s-]+/, '')}`;
            if (['positive', 'neutral', 'negative', 'frustrated'].includes(parsed.sentiment)) {
              sentiment = parsed.sentiment as SentimentType;
            }
            if (Array.isArray(parsed.suggestedTags)) {
              suggestedTags = parsed.suggestedTags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 3);
            }
            if (summaryText) break;
          }
        } catch (genErr) {
          console.warn(`Gemini summary generation attempt with ${model} failed, trying next:`, genErr);
        }
      }
    }

    // Fallback if AI not configured or failed
    if (!summaryText) {
      summaryText = `• Customer communicated regarding: "${(messages[0]?.text || '').slice(0, 60)}..."\n• Support interaction concluded (${messages.length} total messages exchanged).`;
    }

    // If sentiment is still neutral, check the customer's last message with analyzeMessageSentiment
    if (sentiment === 'neutral') {
      const customerMessages = messages.filter(m => !m.fromMe);
      const lastCustomerMsg = customerMessages[customerMessages.length - 1];
      if (lastCustomerMsg) {
        sentiment = await analyzeMessageSentiment(lastCustomerMsg.text);
      }
    }

    // Calculate resolution duration
    const firstMsgTime = messages[0]?.timestamp || Date.now();
    const lastMsgTime = messages[messages.length - 1]?.timestamp || Date.now();
    const durationMs = Math.max(0, lastMsgTime - firstMsgTime);

    // Save summary and sentiment to database
    await db.updateConversation(chatId, {
      aiSummary: summaryText,
      sentiment,
      resolutionDurationMs: durationMs,
    });

    // Add suggested tags to contact
    for (const tag of suggestedTags) {
      await db.addContactTag(chatId, tag);
    }

    await db.addLog({
      user: 'AI Analyst',
      action: 'AI Summary Generated',
      details: `Generated 2-bullet summary for ${chatId} (Sentiment: ${sentiment})`,
      type: 'info',
    });

    return {
      summary: summaryText,
      suggestedTags,
      sentiment,
    };
  } catch (error) {
    console.error(`Failed to generate conversation summary for ${chatId}:`, error);
    return {
      summary: '• Conversation resolved.\n• Automated summary unavailable.',
      suggestedTags: [],
      sentiment: 'neutral',
    };
  }
}
