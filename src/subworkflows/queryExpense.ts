import type { CategoryName } from '../categories.js';
import { formatAmount } from '../currency.js';
import { getSpendingSummary, type SummaryRow } from '../db/repos.js';
import { clarifyOtherCategories, type Clarification } from '../deepseek.js';
import type { MonthRef, PeriodKey } from '../query.js';

export interface QueryExpenseInput {
  userId: number;
  period?: PeriodKey;
  month?: MonthRef;
  category?: CategoryName;
  currency: string;
}

interface ResolvedPeriod {
  startDate: string;
  endDate: string;
  label: string;
}

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function resolvePeriodDates(period: PeriodKey, month: MonthRef | null): ResolvedPeriod {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  if (month) {
    const start = new Date(Date.UTC(month.year, month.month, 1));
    const end = new Date(Date.UTC(month.year, month.month + 1, 1));
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      label: `${MONTH_LABELS[month.month]} ${month.year}`,
    };
  }

  const startOfToday = new Date(Date.UTC(y, m, d));
  const endOfToday = new Date(Date.UTC(y, m, d + 1));

  switch (period) {
    case 'today':
      return {
        startDate: startOfToday.toISOString(),
        endDate: endOfToday.toISOString(),
        label: 'Today',
      };
    case 'week': {
      const delta = (startOfToday.getUTCDay() + 6) % 7;
      const start = new Date(Date.UTC(y, m, d - delta));
      const end = new Date(start.getTime() + 7 * 86400000);
      return { startDate: start.toISOString(), endDate: end.toISOString(), label: 'This Week' };
    }
    case 'last-week': {
      const delta = (startOfToday.getUTCDay() + 6) % 7;
      const thisWeekStart = new Date(Date.UTC(y, m, d - delta));
      const start = new Date(thisWeekStart.getTime() - 7 * 86400000);
      return {
        startDate: start.toISOString(),
        endDate: thisWeekStart.toISOString(),
        label: 'Last Week',
      };
    }
    case 'month':
      return {
        startDate: new Date(Date.UTC(y, m, 1)).toISOString(),
        endDate: new Date(Date.UTC(y, m + 1, 1)).toISOString(),
        label: 'This Month',
      };
    case 'last-month':
      return {
        startDate: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
        endDate: new Date(Date.UTC(y, m, 1)).toISOString(),
        label: 'Last Month',
      };
    case 'year':
      return {
        startDate: new Date(Date.UTC(y, 0, 1)).toISOString(),
        endDate: new Date(Date.UTC(y + 1, 0, 1)).toISOString(),
        label: 'This Year',
      };
    case 'last-year':
      return {
        startDate: new Date(Date.UTC(y - 1, 0, 1)).toISOString(),
        endDate: new Date(Date.UTC(y, 0, 1)).toISOString(),
        label: 'Last Year',
      };
    case 'all':
      return {
        startDate: new Date(Date.UTC(1970, 0, 1)).toISOString(),
        endDate: endOfToday.toISOString(),
        label: 'All Time',
      };
  }
}

interface PreparedSummary {
  rows: SummaryRow[];
  needsAi: boolean;
  otherRows: Array<{ index: number; amount: number; description: string; raw_message: string }>;
}

function prepareSummaryData(rows: SummaryRow[]): PreparedSummary {
  const otherRows = rows
    .map((row, i) => ({
      index: i,
      amount: Number(row.amount || 0),
      description: String(row.description || ''),
      raw_message: String(row.raw_message || ''),
    }))
    .filter((r) => {
      const row = rows[r.index];
      return row ? !row.category || row.category === 'Other' : false;
    });

  return { rows, needsAi: otherRows.length > 0, otherRows };
}

function formatSummary(
  baseRows: SummaryRow[],
  clarifications: Clarification[],
  label: string,
  category: CategoryName | null,
  currency: string,
): string {
  const rows: SummaryRow[] = baseRows.map((row) => ({ ...row }));
  for (const clarification of clarifications) {
    const row = rows[clarification.index];
    if (row) row.category = clarification.category;
  }

  if (category) {
    const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    if (rows.length === 0) {
      return `No ${category} spending found for ${label.toLowerCase()}.`;
    }
    return `📊 ${category} Spending · ${label}\n\nTotal ${formatAmount(total, currency)}`;
  }

  if (rows.length === 0) {
    return `No spending found for ${label.toLowerCase()}.`;
  }

  const totals = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const value = Number(row.amount || 0);
    const cat = row.category || 'Other';
    totals.set(cat, (totals.get(cat) ?? 0) + value);
    total += value;
  }

  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);

  const amountOf = (value: number) => formatAmount(value, currency);
  const catWidth = Math.max('Total'.length, ...sorted.map(([cat]) => cat.length));
  const amountWidth = Math.max(
    ...sorted.map(([, value]) => amountOf(value).length),
    amountOf(total).length,
  );

  const lines = sorted.map(
    ([cat, value]) => cat.padEnd(catWidth) + '  ' + amountOf(value).padStart(amountWidth),
  );
  const separator = '-'.repeat(catWidth + 2 + amountWidth);
  const totalLine = 'Total'.padEnd(catWidth) + '  ' + amountOf(total).padStart(amountWidth);

  return (
    `<pre>📊 ${label} Spending\n\n` +
    lines.join('\n') +
    '\n' +
    separator +
    '\n' +
    totalLine +
    `\n\nHighest category: ${sorted[0]?.[0] ?? 'None'}</pre>`
  );
}

export async function queryExpense(input: QueryExpenseInput): Promise<{ response: string }> {
  const resolved = resolvePeriodDates(input.period ?? 'month', input.month ?? null);
  const rawRows = await getSpendingSummary(
    input.userId,
    resolved.startDate,
    resolved.endDate,
    input.category,
  );
  const { rows, needsAi, otherRows } = prepareSummaryData(rawRows);

  const clarifications = !input.category && needsAi ? await clarifyOtherCategories(otherRows) : [];
  const response = formatSummary(
    rows,
    clarifications,
    resolved.label,
    input.category ?? null,
    input.currency,
  );

  return { response };
}
