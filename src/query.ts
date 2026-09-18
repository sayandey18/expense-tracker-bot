import { CATEGORY_RULES, isCategoryName, type CategoryName } from './categories.js';
import { analyzeSpendingQuery } from './deepseek.js';

export type PeriodKey =
  'today' | 'week' | 'month' | 'last-week' | 'last-month' | 'year' | 'last-year' | 'all';

export interface MonthRef {
  month: number;
  year: number;
}

export interface QueryFilters {
  category: CategoryName | null;
  period: PeriodKey | null;
  month: MonthRef | null;
}

const PERIOD_KEYS: readonly PeriodKey[] = [
  'today',
  'week',
  'month',
  'last-week',
  'last-month',
  'year',
  'last-year',
  'all',
];

const MONTH_NAMES: ReadonlyArray<{ names: string[]; index: number }> = [
  { names: ['january', 'jan'], index: 0 },
  { names: ['february', 'feb'], index: 1 },
  { names: ['march', 'mar'], index: 2 },
  { names: ['april', 'apr'], index: 3 },
  { names: ['may'], index: 4 },
  { names: ['june', 'jun'], index: 5 },
  { names: ['july', 'jul'], index: 6 },
  { names: ['august', 'aug'], index: 7 },
  { names: ['september', 'sep', 'sept'], index: 8 },
  { names: ['october', 'oct'], index: 9 },
  { names: ['november', 'nov'], index: 10 },
  { names: ['december', 'dec'], index: 11 },
];

const PERIOD_HINTS: ReadonlyArray<{ key: PeriodKey; words: string[] }> = [
  { key: 'today', words: ['today'] },
  { key: 'last-week', words: ['last week', 'previous week'] },
  { key: 'last-month', words: ['last month', 'previous month'] },
  { key: 'last-year', words: ['last year', 'previous year'] },
  { key: 'week', words: ['week', 'this week'] },
  { key: 'month', words: ['month', 'this month'] },
  { key: 'year', words: ['year', 'this year'] },
  { key: 'all', words: ['all time', 'overall', 'lifetime', 'in total', 'everything', 'ever'] },
];

function isPeriodKey(value: string): value is PeriodKey {
  return (PERIOD_KEYS as readonly string[]).includes(value);
}

function monthNameToIndex(name: string): number | null {
  const normalized = name.toLowerCase().trim();
  for (const entry of MONTH_NAMES) {
    if (entry.names.includes(normalized)) return entry.index;
  }
  return null;
}

export function extractCategory(text: string): CategoryName | null {
  const lower = text.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.words.some((word) => lower.includes(word))) {
      return rule.category;
    }
  }
  return null;
}

export function extractPeriod(text: string): PeriodKey | null {
  const lower = text.toLowerCase();
  for (const { key, words } of PERIOD_HINTS) {
    if (words.some((word) => lower.includes(word))) {
      return key;
    }
  }
  return null;
}

export function extractMonth(text: string): MonthRef | null {
  const lower = text.toLowerCase();
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  let monthIndex: number | null = null;
  for (const entry of MONTH_NAMES) {
    if (entry.names.some((name) => new RegExp(`\\b${name}\\b`).test(lower))) {
      monthIndex = entry.index;
      break;
    }
  }
  if (monthIndex === null) return null;

  const yearMatch = lower.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch
    ? Number(yearMatch[0])
    : monthIndex > currentMonth
      ? currentYear - 1
      : currentYear;

  return { month: monthIndex, year };
}

export async function resolveQueryFilters(text: string): Promise<QueryFilters> {
  const category = extractCategory(text);
  const period = extractPeriod(text);
  const month = extractMonth(text);

  if (category) {
    return { category, period, month };
  }

  const ai = await analyzeSpendingQuery(text);

  let aiCategory: CategoryName | null = null;
  let aiPeriod: PeriodKey | null = null;
  let aiMonth: MonthRef | null = null;

  if (ai.category && isCategoryName(ai.category)) aiCategory = ai.category;
  if (ai.period && isPeriodKey(ai.period)) aiPeriod = ai.period;

  const aiMonthIndex = ai.month ? monthNameToIndex(ai.month) : null;
  if (aiMonthIndex !== null) {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();
    const year =
      ai.year && ai.year >= 1900 && ai.year <= 2100
        ? ai.year
        : aiMonthIndex > currentMonth
          ? currentYear - 1
          : currentYear;
    aiMonth = { month: aiMonthIndex, year };
  }

  return {
    category: aiCategory,
    period: period ?? aiPeriod,
    month: month ?? aiMonth,
  };
}
