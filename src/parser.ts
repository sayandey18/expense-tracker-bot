import { CATEGORY_RULES, type CategoryName } from './categories.js';

const QUERY_HINTS = [
  'how much',
  'how much did',
  'how much have',
  'what did i spend',
  'what have i spent',
  'spending',
  'summary',
  'total',
  'show me',
  'show my',
  'spent this',
  'spend this',
] as const;

const AMOUNT_REGEX =
  /(?:₹|rs\.?|inr\s*)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(?:rupees?|rs\.?|inr)?/i;

export type ParseResult =
  | { isExpense: false }
  | {
      isExpense: true;
      amount: number;
      category: CategoryName;
      description: string;
      rawMessage: string;
    };

export function parseExpense(rawText: string): ParseResult {
  const text = rawText.trim();
  const lower = text.toLowerCase();

  const looksLikeQuery = QUERY_HINTS.some((hint) => lower.includes(hint));
  const amountMatch = looksLikeQuery ? null : lower.match(AMOUNT_REGEX);

  if (!amountMatch) {
    return { isExpense: false };
  }

  const fullMatch = amountMatch[0];
  const captured = amountMatch[1];
  if (!fullMatch || !captured) {
    return { isExpense: false };
  }

  const amount = Number(captured.replace(/,/g, ''));
  if (!(amount > 0) || amount >= 10000000) {
    return { isExpense: false };
  }

  let description = text
    .replace(fullMatch, ' ')
    .replace(/^(spent|spend|paid|pay|bought|buy|for)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  description = description.replace(/^(on|for)\s+/i, '').trim();
  if (!description) description = 'Expense';

  let category: CategoryName = 'Other';
  for (const rule of CATEGORY_RULES) {
    if (rule.words.some((word) => lower.includes(word))) {
      category = rule.category;
      break;
    }
  }

  return {
    isExpense: true,
    amount,
    category,
    description,
    rawMessage: text,
  };
}
