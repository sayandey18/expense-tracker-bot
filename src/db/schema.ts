import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  smallserial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  telegramUserId: bigint('telegram_user_id', { mode: 'number' }).primaryKey(),
  telegramChatId: bigint('telegram_chat_id', { mode: 'number' }).notNull(),
  username: text('username'),
  firstName: text('first_name'),
  currency: char('currency', { length: 3 }).notNull().default('INR'),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  consentGivenAt: timestamp('consent_given_at', { withTimezone: true }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const categories = pgTable('categories', {
  id: smallserial('id').primaryKey(),
  name: text('name').notNull().unique(),
  emoji: text('emoji'),
});

export const expenses = pgTable(
  'expenses',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    categoryId: smallint('category_id')
      .notNull()
      .references(() => categories.id),
    description: text('description'),
    rawMessage: text('raw_message').notNull(),
    telegramMessageId: bigint('telegram_message_id', { mode: 'number' }),
    spentAt: timestamp('spent_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('expenses_amount_check', sql`${table.amount} > 0 AND ${table.amount} < 10000000`),
    uniqueIndex('expenses_user_id_telegram_message_id_unique').on(
      table.userId,
      table.telegramMessageId,
    ),
    index('idx_expenses_user_month').on(table.userId, table.spentAt),
  ],
);

export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    msgCount: integer('msg_count').notNull().default(1),
  },
  (table) => [primaryKey({ columns: [table.userId, table.windowStart] })],
);

export const subscriptions = pgTable('subscriptions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.telegramUserId),
  plan: text('plan').notNull().default('free'),
  status: text('status').notNull().default('active'),
  provider: text('provider'),
  providerRef: text('provider_ref'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});

export const aiParseFailures = pgTable('ai_parse_failures', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }),
  rawMessage: text('raw_message'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
