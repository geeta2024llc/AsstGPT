import { HandoffRule, HandoffEvaluationResult, Agent, TakeoverCatchUpSummary } from '@/types';
import { getHandoffRules, getMessages, createConversationNote, updateConversation, addLog } from './db';

export const KNOWN_INTENTS = [
  'human_agent_request',
  'complaint_frustration',
  'billing_refund',
  'cancellation',
  'technical_escalation',
  'product_inquiry',
  'general_chat',
] as const;

export type KnownIntent = typeof KNOWN_INTENTS[number];

// Fast heuristics for instant 0ms classification
const HEURISTIC_INTENT_PATTERNS: Array<{ intent: KnownIntent; regex: RegExp }> = [
  {
    intent: 'human_agent_request',
    regex: /\b(human|agent|operator|representative|rep|real person|person|talk to (a )?human|speak to (a )?(human|person|agent|someone|supervisor|manager)|customer care|call me)\b/i,
  },
  {
    intent: 'complaint_frustration',
    regex: /\b(terrible|worst|awful|scam|fraud|useless bot|stupid bot|hate this|complain|complaint|unacceptable|furious|disappointed|angry|lawyer|sue)\b/i,
  },
  {
    intent: 'billing_refund',
    regex: /\b(refund|chargeback|money back|overcharged|double charged|billing issue|wrong amount|unauthorized charge|invoice error)\b/i,
  },
  {
    intent: 'cancellation',
    regex: /\b(cancel(lation)? (my )?(subscription|plan|account|service)|close (my )?account|delete (my )?account|stop renewal|terminate)\b/i,
  },
  {
    intent: 'technical_escalation',
    regex: /\b(crash|broken|bug|error (500|404|code)|system down|outage|not working at all|data loss|critical bug)\b/i,
  },
  {
    intent: 'general_chat',
    regex: /^(hi|hello|hey|good morning|good evening|good afternoon|namaste|नमस्ते|hola|how are you|thank you|thanks|bye|goodbye)\b/i,
  },
  {
    intent: 'product_inquiry',
    regex: /\b(price|pricing|cost|how much|hours|open|schedule|time|location|where|address|service|services|buy|order|catalog|menu|shipping|delivery|policy|quote|info)\b/i,
  },
];

/**
 * Classifies the intent of a customer message using fast regex heuristics,
 * with fallback to lightweight Gemini Flash classification if ambiguous.
 */
export async function classifyIntent(
  messageText: string,
  history?: Array<{ fromMe: boolean; text: string }>
): Promise<KnownIntent> {
  const clean = messageText.trim();
  if (!clean) return 'general_chat';

  // 1. Instant regex check
  for (const { intent, regex } of HEURISTIC_INTENT_PATTERNS) {
    if (regex.test(clean)) {
      return intent;
    }
  }

  // 2. Fast LLM Classification fallback for complex conversational expressions
  const groqKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!groqKey && !geminiKey) {
    return 'product_inquiry';
  }

  const prompt = `Classify the following customer message into EXACTLY ONE of these categories:
- human_agent_request (wants to speak to a person/agent/representative)
- complaint_frustration (angry, upset, dissatisfied, filing a complaint)
- billing_refund (money back, dispute, invoice, charge issues)
- cancellation (wants to cancel service/account/subscription)
- technical_escalation (bug, system failure, broken feature)
- product_inquiry (asking questions about products, services, hours, pricing, general info)
- general_chat (casual greeting, chit-chat, thank you)

Customer Message: "${clean.slice(0, 300)}"
Return ONLY the category name in lowercase with no extra text or explanation:`;

  if (groqKey) {
    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`,
        },
        signal: AbortSignal.timeout(2500),
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 20,
        }),
      });

      const data = await resp.json();
      const rawResult = data.choices?.[0]?.message?.content?.trim()?.toLowerCase() || '';
      const matched = KNOWN_INTENTS.find(i => rawResult.includes(i));
      if (matched) return matched;
    } catch (groqErr) {
      console.warn('[INTENT_CLASSIFIER] Groq classification failed, falling back to Gemini/default:', groqErr);
    }
  }

  if (geminiKey) {
    const candidateModels = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];
    for (const model of candidateModels) {
      try {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(3500),
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 20,
            },
          }),
        });

        const data = await resp.json();
        if (data.error) continue;

        const rawResult = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()?.toLowerCase() || '';
        const matched = KNOWN_INTENTS.find(i => rawResult.includes(i));
        if (matched) return matched;
        return 'product_inquiry';
      } catch (err) {
        console.warn(`[INTENT_CLASSIFIER] Attempt with ${model} failed:`, err);
      }
    }
  }

  return 'product_inquiry';
}

/**
 * Calculates a confidence score (0.0 to 1.0) for an AI response.
 * Detects uncertainty markers, anti-hallucination phrases, and context grounding.
 */
export function calculateAIConfidence(
  responseText: string,
  userQuery: string,
  ragContext?: string
): number {
  if (!responseText || !responseText.trim()) return 0.0;

  const lowerResp = responseText.toLowerCase();

  // 1. Severe uncertainty / missing info signals
  const missingInfoPhrases = [
    'information is not currently available',
    'please contact us directly',
    'i am not sure',
    'i do not have access',
    "i don't have information",
    'cannot assist with that',
    'unable to answer',
    'apologize, but i don',
    'not mentioned in the documents',
  ];

  for (const phrase of missingInfoPhrases) {
    if (lowerResp.includes(phrase)) {
      return 0.35; // Flagged as low confidence
    }
  }

  // 2. High confidence if response was grounded in provided knowledge context
  if (ragContext && ragContext.length > 50) {
    // Check if key words from query appear in response
    const queryWords = userQuery.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const matchedWords = queryWords.filter(w => lowerResp.includes(w));
    const coverage = queryWords.length > 0 ? matchedWords.length / queryWords.length : 0.5;

    return Math.min(0.95, 0.70 + (coverage * 0.25));
  }

  // 3. Conversational / greeting confidence
  const greetings = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'thank you', 'thanks'];
  if (greetings.some(g => userQuery.toLowerCase().trim().startsWith(g))) {
    return 0.95;
  }

  // 4. Default standard confidence
  return 0.78;
}

export interface EvaluateHandoffOptions {
  messageText: string;
  history?: Array<{ fromMe: boolean; text: string }>;
  context?: string;
  consecutiveFallbacks?: number;
  currentConfidence?: number;
  skipIntentClassification?: boolean;
}

/**
 * Evaluates active handoff rules against the incoming message and current state.
 * Returns evaluation result indicating if handoff should occur and which rule triggered it.
 */
export async function evaluateHandoffRules(
  options: EvaluateHandoffOptions
): Promise<HandoffEvaluationResult> {
  const {
    messageText,
    history,
    consecutiveFallbacks = 0,
    currentConfidence,
  } = options;

  const cleanText = (messageText || '').trim();
  const lowerText = cleanText.toLowerCase();

  // 1. Fetch enabled handoff rules sorted by priority DESC
  const rules = await getHandoffRules();
  const enabledRules = rules.filter(r => r.isEnabled);

  if (enabledRules.length === 0) {
    return { shouldHandoff: false };
  }

  let detectedIntent: KnownIntent | undefined;

  for (const rule of enabledRules) {
    switch (rule.ruleType) {
      // Rule 1: Keyword Match
      case 'keyword_match': {
        const keywords = rule.conditions.keywords || [];
        if (keywords.length > 0) {
          const matchedKeyword = keywords.find(kw => {
            const cleanKw = kw.trim().toLowerCase();
            if (!cleanKw) return false;
            // Word boundary match or substring for phrases
            const regex = new RegExp(`\\b${cleanKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            return regex.test(lowerText) || lowerText.includes(cleanKw);
          });

          if (matchedKeyword) {
            return {
              shouldHandoff: true,
              matchedRule: rule,
              reason: `Matched escalation keyword "${matchedKeyword}" (Rule: "${rule.name}")`,
              transitionMessage: rule.actions.transitionMessage,
            };
          }
        }
        break;
      }

      // Rule 2: Intent Detected
      case 'intent_detected': {
        const targetIntents = rule.conditions.intents || [];
        if (targetIntents.length > 0) {
          if (!detectedIntent) {
            detectedIntent = await classifyIntent(cleanText, history);
          }

          if (targetIntents.includes(detectedIntent)) {
            return {
              shouldHandoff: true,
              matchedRule: rule,
              detectedIntent,
              reason: `Detected intent "${detectedIntent}" (Rule: "${rule.name}")`,
              transitionMessage: rule.actions.transitionMessage,
            };
          }
        }
        break;
      }

      // Rule 3: Confidence Threshold
      case 'confidence_threshold': {
        const threshold = rule.conditions.threshold ?? 0.65;
        if (currentConfidence !== undefined && currentConfidence < threshold) {
          return {
            shouldHandoff: true,
            matchedRule: rule,
            confidence: currentConfidence,
            reason: `AI confidence (${(currentConfidence * 100).toFixed(0)}%) below threshold (${(threshold * 100).toFixed(0)}%) (Rule: "${rule.name}")`,
            transitionMessage: rule.actions.transitionMessage,
          };
        }
        break;
      }

      // Rule 4: Consecutive Fallbacks
      case 'consecutive_fallback': {
        const maxFallbacks = rule.conditions.maxFallbacks ?? 2;
        if (consecutiveFallbacks >= maxFallbacks) {
          return {
            shouldHandoff: true,
            matchedRule: rule,
            reason: `${consecutiveFallbacks} consecutive unanswered fallbacks reached threshold of ${maxFallbacks} (Rule: "${rule.name}")`,
            transitionMessage: rule.actions.transitionMessage,
          };
        }
        break;
      }
    }
  }

  return { shouldHandoff: false, detectedIntent };
}

/**
 * Generates an automated Catch-Up Summary / Briefing for human agents picking up a handed-off chat.
 */
export async function generateTakeoverCatchUpSummary(
  chatId: string,
  handoffReason?: string
): Promise<TakeoverCatchUpSummary> {
  try {
    const messages = await getMessages(chatId);
    const recentMessages = (messages || []).slice(-12);

    let customerIntent = 'general_inquiry';
    let customerFrustration: 'low' | 'medium' | 'high' = 'low';
    let keyIssue = 'Customer requested human assistance.';
    let botAttemptsSummary = 'AI provided automated responses.';
    let recommendedNextAction = 'Greet the customer and ask how you can help.';

    if (recentMessages.length > 0) {
      const transcript = recentMessages
        .map(m => `${m.fromMe ? 'Bot/Agent' : 'Customer'}: ${m.text}`)
        .join('\n');

      const customerMessages = recentMessages.filter(m => !m.fromMe);
      const lastCustMsg = customerMessages[customerMessages.length - 1]?.text || '';

      const detectedIntent = await classifyIntent(lastCustMsg);
      customerIntent = detectedIntent;

      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;
      if (apiKey) {
        const prompt = `You are a real-time AI supervisor for human customer support agents.
Analyze this chat transcript and provide a fast 15-second catch-up briefing for the human agent taking over.

Transcript:
${transcript}

Handoff Trigger Reason: ${handoffReason || 'Manual agent takeover'}

Return strictly a JSON object with:
{
  "customerIntent": "short intent phrase",
  "customerFrustration": "low" | "medium" | "high",
  "keyIssue": "1 concise sentence stating the core customer problem/request",
  "botAttemptsSummary": "1 concise sentence summarizing what the bot already answered/attempted",
  "recommendedNextAction": "1 actionable sentence advising what the human agent should do next"
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
                  generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
                }),
                signal: AbortSignal.timeout(4000),
              }
            );

            if (resp.ok) {
              const data = await resp.json();
              const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
              const parsed = JSON.parse(jsonText);
              if (parsed.keyIssue) {
                customerIntent = parsed.customerIntent || customerIntent;
                customerFrustration = ['low', 'medium', 'high'].includes(parsed.customerFrustration) ? parsed.customerFrustration : 'low';
                keyIssue = parsed.keyIssue;
                botAttemptsSummary = parsed.botAttemptsSummary || botAttemptsSummary;
                recommendedNextAction = parsed.recommendedNextAction || recommendedNextAction;
                break;
              }
            }
          } catch (e) {
            // try next model
          }
        }
      } else {
        // Heuristic fallback
        keyIssue = lastCustMsg ? `Customer message: "${lastCustMsg.slice(0, 100)}"` : 'Customer requested human assistance.';
        if (/cancel|refund|angry|terrible|broken|worst/i.test(lastCustMsg)) {
          customerFrustration = 'high';
          recommendedNextAction = 'Prioritize empathy and resolve customer dispute.';
        }
      }
    }

    const summary: TakeoverCatchUpSummary = {
      chatId,
      customerIntent,
      customerFrustration,
      keyIssue,
      botAttemptsSummary,
      recommendedNextAction,
      generatedAt: Date.now(),
    };

    // Save briefing to conversation metadata
    await updateConversation(chatId, {
      handoffMetadata: {
        ...(handoffReason ? { reason: handoffReason } : {}),
        takeoverBriefing: summary,
      },
    });

    // Create an internal timeline note for the human agent
    try {
      await createConversationNote({
        chatId,
        content: `📋 [AI Catch-Up Briefing]\n• Issue: ${summary.keyIssue}\n• Frustration: ${summary.customerFrustration.toUpperCase()}\n• What Bot Did: ${summary.botAttemptsSummary}\n• Next Step: ${summary.recommendedNextAction}`,
        userName: '🤖 AI Catch-Up Briefing',
      });
    } catch (_) {}

    await addLog({
      user: 'Handoff Engine',
      action: 'Catch-Up Summary Generated',
      details: `Generated takeover briefing for ${chatId}: ${summary.keyIssue}`,
      type: 'info',
    });

    return summary;
  } catch (err: any) {
    console.error('Error generating takeover catch-up summary:', err);
    return {
      chatId,
      customerIntent: 'general',
      customerFrustration: 'low',
      keyIssue: 'Customer conversation escalated to human operator.',
      botAttemptsSummary: 'Automated AI bot responses provided.',
      recommendedNextAction: 'Review chat history and assist customer.',
      generatedAt: Date.now(),
    };
  }
}
