import { z } from 'zod';
import { isCategoryName, type CategoryName } from '../categories.js';
import { formatAmount } from '../currency.js';
import { insertExpense } from '../db/repos.js';

const expenseInputSchema = z.object({
  text: z.string(),
  userId: z.number().int(),
  telegramMessageId: z.number().int(),
  telegramChatId: z.number().int(),
  amount: z
    .number()
    .positive()
    .refine((value) => value < 10000000),
  category: z.string(),
  description: z.string(),
  currency: z.string(),
});

export interface LogExpenseInput {
  text: string;
  userId: number;
  telegramMessageId: number;
  telegramChatId: number;
  amount: number;
  category: string;
  description: string;
  currency: string;
}

export async function logExpense(input: LogExpenseInput): Promise<{ response: string }> {
  const parsed = expenseInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error('Invalid expense data');
  }

  const { amount, category: rawCategory, text, currency } = parsed.data;
  const description = parsed.data.description.trim();
  const rawMessage = text.trim();

  if (!description || !rawMessage) {
    throw new Error('Invalid expense data');
  }

  const category: CategoryName = isCategoryName(rawCategory) ? rawCategory : 'Other';

  await insertExpense({
    userId: parsed.data.userId,
    amount,
    category,
    description,
    rawMessage,
    telegramMessageId: parsed.data.telegramMessageId,
  });

  const response = `✅ Logged ${formatAmount(amount, currency)} — ${category}: ${description}`;
  return { response };
}
