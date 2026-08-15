import { getKnowledgeFile, getKnowledgeFiles } from './db';
import type { KnowledgeFile } from '@/types';

export interface FaqEntry {
  question: string;
  answer: string;
  sourceFile: string;
}

export interface FaqMatchResult {
  matched: boolean;
  question?: string;
  answer?: string;
  confidence: number;
  source?: string;
  matchType?: 'exact' | 'token_overlap' | 'fuzzy_similarity' | 'dynamic_cache';
}

/**
 * Common English and Romanized Nepali synonym map for high-accuracy intent matching.
 */
export const SYNONYM_MAP: Record<string, string[]> = {
  // Pricing & Costs
  price: ['cost', 'pricing', 'fee', 'plan', 'rate', 'charge', 'kati', 'paisa'],
  kati: ['price', 'cost', 'pricing', 'rate', 'fee', 'charge'],
  cost: ['price', 'pricing', 'rate', 'fee', 'kati'],
  pricing: ['price', 'cost', 'plan', 'rate', 'kati'],
  plan: ['package', 'tier', 'price', 'pricing', 'service'],
  rate: ['price', 'cost', 'pricing', 'fee'],

  // Payment & QR
  qr: ['payment', 'pay', 'esewa', 'khalti', 'fonepay', 'bank', 'transfer'],
  pay: ['payment', 'qr', 'billing', 'esewa', 'khalti', 'fonepay'],
  payment: ['pay', 'qr', 'esewa', 'khalti', 'fonepay', 'billing'],
  esewa: ['payment', 'qr', 'pay', 'fonepay', 'khalti'],
  khalti: ['payment', 'qr', 'pay', 'fonepay', 'esewa'],
  fonepay: ['payment', 'qr', 'pay', 'esewa', 'khalti'],

  // Location & Address
  location: ['address', 'where', 'place', 'office', 'kahan', 'thaun'],
  kahan: ['location', 'where', 'address', 'office', 'thaun'],
  address: ['location', 'where', 'office', 'place', 'kahan'],
  where: ['location', 'address', 'place', 'kahan'],

  // Working Hours & Schedule
  hours: ['time', 'open', 'schedule', 'timing', 'available', 'kahile'],
  time: ['hours', 'schedule', 'timing', 'open'],
  open: ['hours', 'schedule', 'time', 'timing', 'available'],
  schedule: ['hours', 'time', 'open'],

  // Contact & Support
  contact: ['phone', 'number', 'email', 'reach', 'call', 'support', 'help'],
  phone: ['contact', 'number', 'call', 'reach'],
  number: ['phone', 'contact', 'call'],
  help: ['support', 'assist', 'contact'],
  support: ['help', 'assist', 'contact', 'service'],

  // Services & Products
  service: ['services', 'product', 'products', 'offer', 'feature', 'k'],
  services: ['service', 'product', 'products', 'offer', 'k'],
  product: ['products', 'service', 'services', 'item'],
  products: ['product', 'service', 'services', 'items'],

  // Cancellation, Refunds & Subscriptions
  cancel: ['cancellation', 'refund', 'terminate', 'stop', 'policy', 'subscription'],
  cancellation: ['cancel', 'refund', 'stop', 'policy', 'subscription'],
  refund: ['money', 'cancel', 'cancellation', 'return', 'policy'],
  subscription: ['plan', 'subscribe', 'pricing', 'cancel', 'package'],
  subscribe: ['plan', 'subscription', 'signup'],

  // Delivery & Shipping
  deliver: ['delivery', 'shipping', 'ship'],
  delivery: ['deliver', 'shipping', 'ship'],
  ship: ['delivery', 'shipping', 'dispatch'],
  shipping: ['ship', 'delivery', 'dispatch'],
};

const STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'in', 'to', 'for', 'of', 'with',
  'what', 'how', 'when', 'where', 'who', 'why', 'can', 'you', 'me', 'my', 'is', 'are', 'am',
  'do', 'does', 'your', 'ta', 'ho', 'xa', 'cha', 'k', 'ko', 'ma', 'ra', 'le', 'lai'
]);

/**
 * Normalizes text for clean tokenization and comparison.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u0900-\u097F]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenizes text with synonym expansion.
 */
export function tokenizeQuery(text: string): { rawTokens: string[]; expandedTokens: Set<string> } {
  const normalized = normalizeText(text);
  const rawTokens = normalized
    .split(' ')
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));

  const expandedTokens = new Set<string>(rawTokens);
  for (const token of rawTokens) {
    const syns = SYNONYM_MAP[token];
    if (syns) {
      for (const s of syns) expandedTokens.add(s);
    }
  }

  return { rawTokens, expandedTokens };
}

/**
 * Computes Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;

  const matrix: number[][] = [];
  for (let i = 0; i <= bn; i++) matrix[i] = [i];
  for (let j = 0; j <= an; j++) matrix[0][j] = j;

  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1) // insertion / deletion
        );
      }
    }
  }

  return matrix[bn][an];
}

/**
 * Computes string similarity score between 0.0 and 1.0.
 */
export function calculateFuzzySimilarity(a: string, b: string): number {
  const normA = normalizeText(a);
  const normB = normalizeText(b);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(normA, normB);
  return Math.max(0, 1 - distance / maxLen);
}

/**
 * Extracts Q&A pairs from stored knowledge file content.
 */
export function extractFaqPairs(content: string, fileName: string): FaqEntry[] {
  if (!content || !content.trim()) return [];

  const entries: FaqEntry[] = [];
  const regex = /(?:^|\n+)(?:Q|Question):\s*(.+?)\s*(?:\n+)(?:A|Answer):\s*([\s\S]+?)(?=(?:\n+(?:Q|Question):)|$)/gi;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const question = match[1]?.trim();
    const answer = match[2]?.trim();
    if (question && answer) {
      entries.push({ question, answer, sourceFile: fileName });
    }
  }

  // Fallback: If content doesn't use Q:/A: markers, check line-by-line key-value pairs (e.g. "Price: ...", "Hours: ...")
  if (entries.length === 0) {
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0 && colonIdx < line.length - 1) {
        const topic = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (topic.length > 2 && value.length > 2) {
          entries.push({
            question: topic,
            answer: line,
            sourceFile: fileName,
          });
        }
      }
    }
  }

  return entries;
}

/**
 * Finds an exact or high-confidence fuzzy match from active Knowledge Base FAQs.
 * Returns match result in < 10ms with $0.00 LLM cost.
 */
export async function findDirectFaqMatch(
  userQuery: string,
  fileIds?: string[]
): Promise<FaqMatchResult> {
  const cleanQuery = normalizeText(userQuery);
  if (!cleanQuery || cleanQuery.length < 2) {
    return { matched: false, confidence: 0 };
  }

  // 1. Fetch enabled knowledge files
  let files: KnowledgeFile[] = [];
  if (fileIds && fileIds.length > 0) {
    const fetched = await Promise.all(fileIds.map(getKnowledgeFile));
    files = fetched.filter((f): f is KnowledgeFile => Boolean(f) && f?.enabled !== false && f?.status !== 'disabled');
  } else {
    const allFiles = await getKnowledgeFiles();
    files = allFiles.filter(f => f.enabled !== false && f.status !== 'disabled');
  }

  if (files.length === 0) {
    return { matched: false, confidence: 0 };
  }

  // 2. Extract all Q&A entries
  const allEntries: FaqEntry[] = [];
  for (const f of files) {
    const entries = extractFaqPairs(f.content, f.fileName);
    allEntries.push(...entries);
  }

  if (allEntries.length === 0) {
    return { matched: false, confidence: 0 };
  }

  const { rawTokens: queryTokens, expandedTokens: queryExpanded } = tokenizeQuery(userQuery);

  let bestMatch: FaqMatchResult = { matched: false, confidence: 0 };

  for (const entry of allEntries) {
    const normQuestion = normalizeText(entry.question);

    // --- Level 1: Exact / Normalized Match (100% confidence) ---
    if (cleanQuery === normQuestion || normQuestion.includes(cleanQuery)) {
      return {
        matched: true,
        question: entry.question,
        answer: entry.answer,
        confidence: 1.0,
        source: entry.sourceFile,
        matchType: 'exact',
      };
    }

    // Split multiple questions separated by / or | (e.g. "Kati price ho? / What is the price?")
    const subQuestions = entry.question.split(/[/|]/).map(s => normalizeText(s)).filter(Boolean);
    for (const subQ of subQuestions) {
      if (cleanQuery === subQ || subQ.includes(cleanQuery)) {
        return {
          matched: true,
          question: entry.question,
          answer: entry.answer,
          confidence: 1.0,
          source: entry.sourceFile,
          matchType: 'exact',
        };
      }
    }

    // --- Level 2: Token Overlap & Synonym Matching ---
    const { rawTokens: questionTokens, expandedTokens: questionExpanded } = tokenizeQuery(entry.question);
    
    if (queryTokens.length > 0 && questionTokens.length > 0) {
      let matchedTokenCount = 0;
      for (const qToken of queryTokens) {
        if (questionExpanded.has(qToken)) {
          matchedTokenCount++;
        }
      }

      const overlapScore = matchedTokenCount / Math.max(queryTokens.length, 1);

      // If at least 75% of meaningful tokens match
      if (overlapScore >= 0.75 && matchedTokenCount >= 1) {
        const confidence = Math.min(0.95, 0.75 + overlapScore * 0.2);
        if (confidence > bestMatch.confidence) {
          bestMatch = {
            matched: true,
            question: entry.question,
            answer: entry.answer,
            confidence,
            source: entry.sourceFile,
            matchType: 'token_overlap',
          };
        }
      }
    }

    // --- Level 3: Fuzzy Levenshtein Similarity ---
    const similarity = calculateFuzzySimilarity(cleanQuery, normQuestion);
    if (similarity >= 0.80 && similarity > bestMatch.confidence) {
      bestMatch = {
        matched: true,
        question: entry.question,
        answer: entry.answer,
        confidence: similarity,
        source: entry.sourceFile,
        matchType: 'fuzzy_similarity',
      };
    }
  }

  return bestMatch;
}

// ---------------------------------------------------------------------------
// Dynamic In-Memory Response Cache (1-hour TTL, max 1000 items)
// ---------------------------------------------------------------------------

interface CacheItem {
  response: string;
  createdAt: number;
}

class ResponseCache {
  private cache = new Map<string, CacheItem>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries = 1000, ttlMs = 60 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(query: string): string | null {
    const key = normalizeText(query);
    if (!key) return null;

    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() - item.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    return item.response;
  }

  set(query: string, response: string): void {
    const key = normalizeText(query);
    if (!key || !response) return;

    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, { response, createdAt: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

export const dynamicResponseCache = new ResponseCache();
