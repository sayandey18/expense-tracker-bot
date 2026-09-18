import axios from 'axios';
import { ALLOWED_CATEGORIES, isCategoryName, type CategoryName } from './categories.js';
import { config } from './config.js';
import { logger } from './logger.js';

const client = axios.create({
  baseURL: config.deepseekApiBase,
  timeout: 20000,
  headers: {
    Authorization: `Bearer ${config.deepseekApiKey}`,
    'Content-Type': 'application/json',
  },
});

export type Intent = 'log_expense' | 'spending_query' | 'unclear' | 'other';

const INTENTS: readonly Intent[] = ['log_expense', 'spending_query', 'unclear', 'other'];

function isIntent(value: string): value is Intent {
  return (INTENTS as readonly string[]).includes(value);
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

async function chatJSON(
  systemPrompt: string,
  userText: string,
  { retries = 2 }: { retries?: number } = {},
): Promise<Record<string, unknown>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { data } = await client.post<ChatCompletionResponse>('/chat/completions', {
        model: config.deepseekModel,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
      });
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty DeepSeek response');
      return JSON.parse(content) as Record<string, unknown>;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('DeepSeek request failed');
}

export async function classifyMessage(text: string): Promise<Intent> {
  const systemPrompt = [
    'Classify the user message into exactly one category.',
    'Categories:',
    '- log_expense: The message describes money spent — an amount plus what it was for, e.g. "₹450 dinner with friends" or "200 for uber".',
    '- spending_query: The user is asking about past spending, totals, or summaries, e.g. "how much did I spend this month" or "food total this week".',
    "- unclear: Doesn't fit either — greetings, unrelated chit-chat, garbled text.",
    'If truly none of the above fit, use "other".',
    'Respond with ONLY a JSON object: {"category": "<log_expense|spending_query|unclear|other>"}',
  ].join('\n');

  try {
    const result = await chatJSON(systemPrompt, text);
    const category = String(result.category ?? '').toLowerCase();
    return isIntent(category) ? category : 'unclear';
  } catch (err) {
    logger.error({ err }, '[deepseek] classifyMessage failed');
    return 'unclear';
  }
}

export interface Clarification {
  index: number;
  category: CategoryName;
}

export interface SpendingQueryAnalysis {
  category: string | null;
  period: string | null;
  month: string | null;
  year: number | null;
}

export async function analyzeSpendingQuery(text: string): Promise<SpendingQueryAnalysis> {
  const systemPrompt = [
    "You are an expense-tracking assistant. Given a user's spending question, extract the following fields:",
    `- "category": the expense category the user asks about, mapped to exactly one of: ${ALLOWED_CATEGORIES.join(', ')}. Map synonyms to the closest category (e.g. "travelling" -> "Travel", "cab" -> "Transport", "eating out" -> "Food"). Use null if no category is mentioned.`,
    '- "period": a relative period if stated — one of "today", "week", "month", "last-week", "last-month", "year", "last-year", "all" — or null if unspecified.',
    '- "month": if a specific month is named, its full English name (e.g. "august"), else null.',
    '- "year": the 4-digit year if the user names one (e.g. 2025), else null.',
    'Respond with ONLY a JSON object: {"category": <string|null>, "period": <string|null>, "month": <string|null>, "year": <number|null>}',
  ].join('\n');

  try {
    const result = await chatJSON(systemPrompt, text);
    return {
      category: typeof result.category === 'string' ? result.category : null,
      period: typeof result.period === 'string' ? result.period : null,
      month: typeof result.month === 'string' ? result.month : null,
      year: typeof result.year === 'number' && Number.isInteger(result.year) ? result.year : null,
    };
  } catch (err) {
    logger.error({ err }, '[deepseek] analyzeSpendingQuery failed');
    return { category: null, period: null, month: null, year: null };
  }
}

export interface OtherExpenseRow {
  index: number;
  amount: number;
  description: string;
  raw_message: string;
}

export async function clarifyOtherCategories(
  otherRows: OtherExpenseRow[],
): Promise<Clarification[]> {
  if (!otherRows.length) return [];

  const systemPrompt = [
    'Classify each supplied expense into exactly one allowed category.',
    'Use the expense description and raw message. Do not invent categories.',
    `Allowed categories: ${ALLOWED_CATEGORIES.join(', ')}.`,
    'Return the same index values supplied. Be conservative: use Other when uncertain.',
    'Respond with ONLY a JSON object: {"items": [{"index": <int>, "category": "<category>"}, ...]}',
  ].join('\n');

  const userText =
    'Classify only these expense records that are currently Other. Return one category per index.\n' +
    otherRows.map((row) => JSON.stringify(row)).join('\n');

  try {
    const result = await chatJSON(systemPrompt, userText);
    const items = Array.isArray(result.items) ? result.items : [];

    const clarifications: Clarification[] = [];
    for (const item of items) {
      const index = (item as { index?: unknown }).index;
      const category = (item as { category?: unknown }).category;
      if (
        typeof index === 'number' &&
        Number.isInteger(index) &&
        typeof category === 'string' &&
        isCategoryName(category)
      ) {
        clarifications.push({ index, category });
      }
    }
    return clarifications;
  } catch (err) {
    logger.error({ err }, '[deepseek] clarifyOtherCategories failed');
    return [];
  }
}
