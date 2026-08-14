import { NextResponse } from 'next/server';
import { evaluateHandoffRules, classifyIntent, calculateAIConfidence } from '@/lib/handoff-engine';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messageText, simulatedConfidence, consecutiveFallbacks } = body;

    if (!messageText) {
      return NextResponse.json({ message: 'Missing messageText' }, { status: 400 });
    }

    const detectedIntent = await classifyIntent(messageText);
    const confidence = typeof simulatedConfidence === 'number'
      ? simulatedConfidence
      : calculateAIConfidence("Sample AI response for preview", messageText);

    const evaluation = await evaluateHandoffRules({
      messageText,
      consecutiveFallbacks: consecutiveFallbacks || 0,
      currentConfidence: confidence,
    });

    return NextResponse.json({
      messageText,
      detectedIntent,
      calculatedConfidence: confidence,
      shouldHandoff: evaluation.shouldHandoff,
      matchedRule: evaluation.matchedRule,
      reason: evaluation.reason,
      transitionMessage: evaluation.transitionMessage,
    });
  } catch (error) {
    console.error('Failed to test handoff evaluation:', error);
    return NextResponse.json({ message: 'Failed to evaluate test message' }, { status: 500 });
  }
}
