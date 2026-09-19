import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { CategoryName } from '../categories.js';
import { db, pool } from './client.js';
import { categories, expenses, rateLimitCounters, subscriptions, users } from './schema.js';

export async function isDuplicateMessage(
  userId: number,
  telegramMessageId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.userId, userId), eq(expenses.telegramMessageId, telegramMessageId ?? 0)))
    .limit(1);
  return rows.length > 0;
}

export async function isRegistered(userId: number): Promise<boolean> {
  const rows = await db
    .select({ telegramUserId: users.telegramUserId })
    .from(users)
    .where(and(eq(users.telegramUserId, userId), eq(users.isActive, true)))
    .limit(1);
  return rows.length > 0;
}

export async function bumpRateLimit(userId: number): Promise<number> {
  const rows = await db
    .insert(rateLimitCounters)
    .values({ userId, windowStart: sql`date_trunc('minute', now())`, msgCount: 1 })
    .onConflictDoUpdate({
      target: [rateLimitCounters.userId, rateLimitCounters.windowStart],
      set: { msgCount: sql`${rateLimitCounters.msgCount} + 1` },
    })
    .returning({ msgCount: rateLimitCounters.msgCount });
  return rows[0]?.msgCount ?? 0;
}

export interface RegisterUserInput {
  userId: number;
  chatId: number;
  username: string;
  firstName: string;
}

export async function registerUser(input: RegisterUserInput): Promise<void> {
  const username = input.username || 'unknown';
  const firstName = input.firstName || 'User';
  await db
    .insert(users)
    .values({
      telegramUserId: input.userId,
      telegramChatId: input.chatId,
      username,
      firstName,
      consentGivenAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: users.telegramUserId,
      set: {
        telegramChatId: input.chatId,
        username,
        firstName,
        isActive: true,
      },
    });
}

export interface UserSettings {
  currency: string;
  timezone: string;
}

export async function getUserSettings(userId: number): Promise<UserSettings | null> {
  const rows = await db
    .select({ currency: users.currency, timezone: users.timezone })
    .from(users)
    .where(and(eq(users.telegramUserId, userId), eq(users.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function setUserCurrency(userId: number, currency: string): Promise<void> {
  await db.update(users).set({ currency }).where(eq(users.telegramUserId, userId));
}

export async function setUserTimezone(userId: number, timezone: string): Promise<void> {
  await db.update(users).set({ timezone }).where(eq(users.telegramUserId, userId));
}

export interface LastExpense {
  amount: string;
  category: string;
  description: string | null;
  spentAt: Date;
}

export async function getLastExpense(userId: number): Promise<LastExpense | null> {
  const rows = await db
    .select({
      amount: expenses.amount,
      category: categories.name,
      description: expenses.description,
      spentAt: expenses.spentAt,
    })
    .from(expenses)
    .innerJoin(categories, eq(expenses.categoryId, categories.id))
    .where(eq(expenses.userId, userId))
    .orderBy(desc(expenses.spentAt))
    .limit(1);
  return rows[0] ?? null;
}

export interface DeletedExpense {
  id: number;
  amount: string;
  description: string | null;
}

export async function deleteLastExpense(userId: number): Promise<DeletedExpense | null> {
  const subquery = db
    .select({ id: expenses.id })
    .from(expenses)
    .where(eq(expenses.userId, userId))
    .orderBy(desc(expenses.spentAt))
    .limit(1);
  const rows = await db
    .delete(expenses)
    .where(inArray(expenses.id, subquery))
    .returning({ id: expenses.id, amount: expenses.amount, description: expenses.description });
  return rows[0] ?? null;
}

export interface RecentExpense {
  id: number;
  amount: string;
  category: string;
  description: string | null;
  spentAt: Date;
}

export async function listRecentExpenses(
  userId: number,
  limit: number,
  offset: number,
): Promise<{ rows: RecentExpense[]; total: number }> {
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: expenses.id,
        amount: expenses.amount,
        category: categories.name,
        description: expenses.description,
        spentAt: expenses.spentAt,
      })
      .from(expenses)
      .innerJoin(categories, eq(expenses.categoryId, categories.id))
      .where(eq(expenses.userId, userId))
      .orderBy(desc(expenses.spentAt), desc(expenses.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(expenses)
      .where(eq(expenses.userId, userId)),
  ]);
  return { rows, total: totalRows[0]?.count ?? 0 };
}

export async function deleteExpenseById(
  userId: number,
  id: number,
): Promise<DeletedExpense | null> {
  const rows = await db
    .delete(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
    .returning({ id: expenses.id, amount: expenses.amount, description: expenses.description });
  return rows[0] ?? null;
}

export interface ExportedExpense {
  id: number;
  amount: string;
  category: string;
  description: string | null;
  rawMessage: string;
  spentAt: Date;
  createdAt: Date;
}

export async function exportExpenses(userId: number): Promise<ExportedExpense[]> {
  return db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      category: categories.name,
      description: expenses.description,
      rawMessage: expenses.rawMessage,
      spentAt: expenses.spentAt,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .innerJoin(categories, eq(expenses.categoryId, categories.id))
    .where(eq(expenses.userId, userId))
    .orderBy(asc(expenses.spentAt));
}

export async function deleteAllUserData(userId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(expenses).where(eq(expenses.userId, userId));
    await tx.delete(rateLimitCounters).where(eq(rateLimitCounters.userId, userId));
    await tx.delete(subscriptions).where(eq(subscriptions.userId, userId));
    await tx.delete(users).where(eq(users.telegramUserId, userId));
  });
}

export interface InsertExpenseInput {
  userId: number;
  amount: number;
  category: CategoryName;
  description: string;
  rawMessage: string;
  telegramMessageId: number;
}

export async function insertExpense(input: InsertExpenseInput): Promise<void> {
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, input.category))
    .limit(1);
  if (!category) {
    throw new Error(`Unknown category: ${input.category}`);
  }
  await db
    .insert(expenses)
    .values({
      userId: input.userId,
      amount: String(input.amount),
      categoryId: category.id,
      description: input.description,
      rawMessage: input.rawMessage,
      telegramMessageId: input.telegramMessageId,
    })
    .onConflictDoNothing({ target: [expenses.userId, expenses.telegramMessageId] });
}

export interface SummaryRow {
  category: string;
  amount: number | string;
  description: string | null;
  raw_message: string | null;
  spent_at: string;
}

export async function getSpendingSummary(
  userId: number,
  startDate: string,
  endDate: string,
  category?: CategoryName,
): Promise<SummaryRow[]> {
  const params: (string | number)[] = [userId, startDate, endDate];
  const categoryFilter = category ? ' AND c.name = $4' : '';
  if (category) params.push(category);

  const { rows } = await pool.query<{ rows: unknown }>(
    `SELECT COALESCE(json_agg(json_build_object(
       'category', c.name,
       'amount', e.amount,
       'description', e.description,
       'raw_message', e.raw_message,
       'spent_at', e.spent_at
     ) ORDER BY e.spent_at DESC), '[]'::json) AS rows
     FROM expenses e
     JOIN categories c ON c.id = e.category_id
     WHERE e.user_id = $1 AND e.spent_at >= $2 AND e.spent_at < $3${categoryFilter}`,
    params,
  );
  const raw = rows[0]?.rows;
  if (Array.isArray(raw)) return raw as SummaryRow[];
  if (typeof raw === 'string') return JSON.parse(raw || '[]') as SummaryRow[];
  return [];
}
