
'use server';

import {
  intelligentResponseSelection,
  type IntelligentResponseSelectionInput,
} from '@/ai/flows/intelligent-response-selection';
import { getKnowledgeFile } from './db';
import { generateAIResponse } from './ai';
import type { AISettings } from '@/types';

export async function getAiSuggestions(input: {
  keywords: string;
  knowledgeFileIds?: string[];
}) {
  try {
    let context = '';
    if (input.knowledgeFileIds && input.knowledgeFileIds.length > 0) {
      const contextPromises = input.knowledgeFileIds.map(getKnowledgeFile);
      const files = await Promise.all(contextPromises);
      context = files
        .filter(Boolean)
        .map(file => `Content from ${file!.fileName}:\n${file!.content}`)
        .join('\n\n---\n\n');
    }

    const aiInput: IntelligentResponseSelectionInput = {
      keywords: input.keywords,
      numSuggestions: 3,
      context: context || undefined,
    };
    const result = await intelligentResponseSelection(aiInput);
    return { suggestions: result.suggestedResponses };
  } catch (e: any) {
    console.error('AI Suggestion Error:', e);
    return { error: 'Failed to get suggestions from AI. Please try again.' };
  }
}

/**
 * Generates a live test reply using draft (possibly unsaved) AI settings, so a user can
 * verify an agent's behavior in the Designer before saving it.
 */
export async function testAgentReply(input: {
  message: string;
  aiSettings: AISettings;
}): Promise<{ reply?: string; error?: string }> {
  try {
    if (!input.message?.trim()) {
      return { error: 'Enter a message to test.' };
    }
    const reply = await generateAIResponse(input.message, input.aiSettings, []);
    return { reply: reply || undefined };
  } catch (e: any) {
    console.error('Test Agent Reply Error:', e);
    return { error: e.message || 'Failed to generate a test reply.' };
  }
}
