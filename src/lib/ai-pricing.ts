import type { AIProvider } from '@/types';

/**
 * Approximate USD price per 1M tokens, manually maintained for cost
 * estimation in the super-admin AI usage dashboard only -- not billing-grade.
 * Update these figures if provider pricing changes materially.
 */
const PRICING_PER_MILLION_TOKENS: Record<AIProvider, { input: number; output: number }> = {
  openai: { input: 0.5, output: 1.5 },       // gpt-3.5-turbo / gpt-4o-mini blend
  gemini: { input: 0.075, output: 0.3 },     // gemini flash-lite tier
  anthropic: { input: 3.0, output: 15.0 },   // claude-3-sonnet
  groq: { input: 0.59, output: 0.79 },       // llama-3.3-70b-versatile
};

export function estimateCostUsd(
  provider: AIProvider,
  inputTokens?: number,
  outputTokens?: number
): number | null {
  const pricing = PRICING_PER_MILLION_TOKENS[provider];
  if (!pricing || (inputTokens === undefined && outputTokens === undefined)) return null;

  const inputCost = ((inputTokens || 0) / 1_000_000) * pricing.input;
  const outputCost = ((outputTokens || 0) / 1_000_000) * pricing.output;
  return Number((inputCost + outputCost).toFixed(6));
}
