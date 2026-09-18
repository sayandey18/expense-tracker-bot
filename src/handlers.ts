import { Bot, InlineKeyboard, InputFile, type Context } from 'grammy';
import { classifyMessage } from './deepseek.js';
import * as repos from './db/repos.js';
import { logger } from './logger.js';
import { parseExpense } from './parser.js';
import { resolveQueryFilters } from './query.js';
import { logExpense } from './subworkflows/logExpense.js';
import { queryExpense } from './subworkflows/queryExpense.js';

type TgMessage = NonNullable<Context['message']>;
type TgCallbackQuery = NonNullable<Context['callbackQuery']>;

const RATE_LIMIT_PER_MINUTE = 30;

const PRIVATE_COMMANDS = new Set([
  '/today',
  '/week',
  '/month',
  '/last',
  '/delete',
  '/export',
  '/deleteme',
]);

interface NormalizedUpdate {
  userId: number;
  chatId: number;
  telegramMessageId: number;
  text: string;
  username: string;
  firstName: string;
}

function textOfMessage(msg: TgMessage | undefined): string {
  if (msg && 'text' in msg) return msg.text ?? '';
  return '';
}

function normalizeMessageUpdate(msg: TgMessage | undefined): NormalizedUpdate {
  return {
    userId: msg?.from?.id ?? 0,
    chatId: msg?.chat?.id ?? 0,
    telegramMessageId: msg?.message_id ?? 0,
    text: textOfMessage(msg),
    username: msg?.from?.username ?? '',
    firstName: msg?.from?.first_name ?? '',
  };
}

function normalizeCallbackUpdate(cbq: TgCallbackQuery | undefined): NormalizedUpdate {
  return {
    userId: cbq?.from?.id ?? 0,
    chatId: cbq?.message?.chat?.id ?? 0,
    telegramMessageId: cbq?.message?.message_id ?? 0,
    text: cbq?.data ?? '',
    username: cbq?.from?.username ?? '',
    firstName: cbq?.from?.first_name ?? '',
  };
}

function buildCsv(rows: repos.ExportedExpense[]): string {
  const header = 'id,amount,category,description,raw_message,spent_at,created_at';
  const esc = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((row) =>
    [row.id, row.amount, row.category, row.description, row.rawMessage, row.spentAt, row.createdAt]
      .map(esc)
      .join(','),
  );
  return [header, ...lines].join('\n');
}

type Replier = (text: string) => Promise<unknown>;

function replier(bot: Bot, chatId: number): Replier {
  return (text) => bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

async function handleCallbackQuery(bot: Bot, ctx: Context): Promise<void> {
  const u = normalizeCallbackUpdate(ctx.callbackQuery);
  const reply = replier(bot, u.chatId);

  if (u.text === 'consent:agree') {
    await repos.registerUser({
      userId: u.userId,
      chatId: u.chatId,
      username: u.username,
      firstName: u.firstName,
    });
    await ctx.answerCallbackQuery("Saved — you're registered ✅");
    await reply("You're registered ✅ Send an expense like: ₹450 dinner with friends");
  } else if (u.text === 'consent:cancel') {
    await ctx.answerCallbackQuery('No problem — nothing was saved.');
    await reply('No problem, /register anytime.');
  }
}

async function handleAuthenticatedFreeText(bot: Bot, u: NormalizedUpdate): Promise<void> {
  const reply = replier(bot, u.chatId);
  const parsed = parseExpense(u.text);

  if (parsed.isExpense) {
    try {
      const { response } = await logExpense({
        text: u.text,
        userId: u.userId,
        telegramMessageId: u.telegramMessageId,
        telegramChatId: u.chatId,
        amount: parsed.amount,
        category: parsed.category,
        description: parsed.description,
      });
      await reply(response);
    } catch (err) {
      logger.error({ err }, '[logExpense] failed');
      await reply("Sorry, I couldn't log that expense — could you try rephrasing it?");
    }
    return;
  }

  const intent = await classifyMessage(u.text);

  if (intent === 'spending_query') {
    const filters = await resolveQueryFilters(u.text);
    const { response } = await queryExpense({
      userId: u.userId,
      period: filters.period ?? undefined,
      month: filters.month ?? undefined,
      category: filters.category ?? undefined,
    });
    await reply(response || 'No spending found.');
  } else if (intent === 'unclear') {
    await reply('I couldn’t understand that. Try: ₹450 dinner with friends');
  } else if (intent === 'log_expense') {
    await reply(
      'That sounds like an expense, but I couldn’t pick out an amount. Could you resend it like: ₹450 dinner with friends?',
    );
  }
}

async function handlePrivateCommand(bot: Bot, u: NormalizedUpdate): Promise<void> {
  const reply = replier(bot, u.chatId);

  switch (u.text) {
    case '/today': {
      const { response } = await queryExpense({ userId: u.userId, period: 'today' });
      await reply(response || 'No spending found.');
      break;
    }
    case '/week': {
      const { response } = await queryExpense({ userId: u.userId, period: 'week' });
      await reply(response || 'No spending found.');
      break;
    }
    case '/month': {
      const { response } = await queryExpense({ userId: u.userId, period: 'month' });
      await reply(response || 'No spending found.');
      break;
    }
    case '/last': {
      const last = await repos.getLastExpense(u.userId);
      await reply(
        last
          ? `Last: ₹${last.amount} — ${last.category}: ${last.description}`
          : 'No expenses logged yet.',
      );
      break;
    }
    case '/delete': {
      const deleted = await repos.deleteLastExpense(u.userId);
      await reply(
        deleted
          ? `Deleted ₹${deleted.amount} — ${deleted.description}`
          : 'No expense found to delete.',
      );
      break;
    }
    case '/export': {
      const rows = await repos.exportExpenses(u.userId);
      const csv = buildCsv(rows);
      await bot.api.sendDocument(
        u.chatId,
        new InputFile(Buffer.from(csv, 'utf-8'), 'expenses.csv'),
      );
      break;
    }
    case '/deleteme': {
      await repos.deleteAllUserData(u.userId);
      await reply(
        'Your account and stored expense data have been deleted. You can use /register anytime.',
      );
      break;
    }
  }
}

async function handleTextUpdate(bot: Bot, u: NormalizedUpdate): Promise<void> {
  const reply = replier(bot, u.chatId);

  if (await repos.isDuplicateMessage(u.userId, u.telegramMessageId)) {
    return;
  }

  if (u.text === '/register') {
    await bot.api.sendMessage(
      u.chatId,
      'I can store your Telegram ID and the expenses you send me. Do you agree?',
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text('✅ I agree', 'consent:agree')
          .row()
          .text('Cancel', 'consent:cancel'),
      },
    );
    return;
  }

  if (u.text === '/help') {
    await reply(
      "Expense examples:\n\n1. ₹450 dinner with friends\n2. 200 for uber\n\nCommands: \n/start - Start the bot\n/register - Register your account\n/today - View today's expenses\n/week - View this week's expenses\n/month - View this month's expenses\n/last - View your last expense\n/delete - Delete your last expense\n/export - Export your expenses as CSV\n/deleteme - Delete your account and all data\n/cancel - Cancel any pending action",
    );
    return;
  }

  if (u.text === '/start') {
    await reply(
      'Hi! 👋 I’m your expense manager bot. Send an expense like ₹450 dinner with friends, or use /register to get started.',
    );
    return;
  }

  if (!(await repos.isRegistered(u.userId))) {
    await reply('Please send /register to register first.');
    return;
  }

  const msgCount = await repos.bumpRateLimit(u.userId);
  if (!(msgCount < RATE_LIMIT_PER_MINUTE + 1)) {
    await reply('Too many messages, slow down a bit.');
    return;
  }

  if (u.text === '/cancel') {
    await reply('Cancelled. Any pending bot action has been cleared.');
    return;
  }

  if (PRIVATE_COMMANDS.has(u.text)) {
    await handlePrivateCommand(bot, u);
    return;
  }

  await handleAuthenticatedFreeText(bot, u);
}

export async function handleMessage(bot: Bot, ctx: Context): Promise<void> {
  await handleTextUpdate(bot, normalizeMessageUpdate(ctx.message));
}

export async function handleEditedMessage(bot: Bot, ctx: Context): Promise<void> {
  await handleTextUpdate(bot, normalizeMessageUpdate(ctx.editedMessage));
}

export async function handleCallback(bot: Bot, ctx: Context): Promise<void> {
  await handleCallbackQuery(bot, ctx);
}
