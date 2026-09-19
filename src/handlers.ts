import { Bot, InlineKeyboard, InputFile, type Context } from 'grammy';
import { CURRENCIES, CURRENCY_ORDER, TIMEZONES, formatAmount } from './currency.js';
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
  '/list',
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

function currencyKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < CURRENCY_ORDER.length; i += 3) {
    for (const code of CURRENCY_ORDER.slice(i, i + 3)) {
      keyboard.text(`${CURRENCIES[code]?.symbol ?? code} ${code}`, `cur:${code}`);
    }
    keyboard.row();
  }
  return keyboard;
}

function timezoneKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < TIMEZONES.length; i += 2) {
    for (const tz of TIMEZONES.slice(i, i + 2)) {
      keyboard.text(tz.label, `tz:${tz.id}`);
    }
    keyboard.row();
  }
  return keyboard;
}

const LIST_PAGE_SIZE = 10;

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function formatListDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTH_ABBR[date.getUTCMonth()] ?? ''}`;
}

function renderExpenseList(
  rows: repos.RecentExpense[],
  total: number,
  offset: number,
  currency: string,
): { text: string; keyboard: InlineKeyboard } {
  const from = offset + 1;
  const to = offset + rows.length;
  const text = rows.length
    ? `🗂 Your expenses — ${total} total (showing ${from}–${to})\nTap an entry to delete it.`
    : 'No expenses logged yet.';

  const keyboard = new InlineKeyboard();
  for (const row of rows) {
    const description = row.description ? row.description.slice(0, 24) : '';
    const parts = [formatAmount(row.amount, currency), row.category];
    if (description) parts.push(description);
    parts.push(formatListDate(row.spentAt));
    keyboard.text(`🗑 ${parts.join(' · ')}`, `del:${row.id}:${offset}`).row();
  }

  if (offset > 0) {
    keyboard.text('◀ Prev', `page:${Math.max(0, offset - LIST_PAGE_SIZE)}`);
  }
  if (offset + rows.length < total) {
    keyboard.text('Next ▶', `page:${offset + LIST_PAGE_SIZE}`);
  }

  return { text, keyboard };
}

async function refreshList(
  bot: Bot,
  ctx: Context,
  userId: number,
  offset: number,
): Promise<void> {
  const settings = await repos.getUserSettings(userId);
  const currency = settings?.currency ?? 'INR';
  const { rows, total } = await repos.listRecentExpenses(userId, LIST_PAGE_SIZE, offset);
  const effectiveOffset =
    rows.length === 0 && total > 0 ? Math.max(0, offset - LIST_PAGE_SIZE) : offset;

  const { rows: pageRows, total: pageTotal } =
    effectiveOffset === offset
      ? { rows, total }
      : await repos.listRecentExpenses(userId, LIST_PAGE_SIZE, effectiveOffset);

  if (pageTotal === 0) {
    await ctx.deleteMessage();
    await bot.api.sendMessage(userId, 'No expenses logged yet.');
    return;
  }

  const rendered = renderExpenseList(pageRows, pageTotal, effectiveOffset, currency);
  try {
    await ctx.editMessageText(rendered.text, { reply_markup: rendered.keyboard });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (!message.includes('message is not modified')) {
      logger.error({ err }, '[list] editMessageText failed');
    }
  }
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
    await bot.api.sendMessage(u.chatId, 'Great! Now select your currency', {
      reply_markup: currencyKeyboard(),
    });
  } else if (u.text === 'consent:cancel') {
    await ctx.answerCallbackQuery('No problem — nothing was saved.');
    await reply('No problem, /register anytime.');
  } else if (u.text.startsWith('cur:')) {
    const code = u.text.slice(4);
    if (!CURRENCIES[code]) {
      await ctx.answerCallbackQuery('Unknown currency.');
      return;
    }
    await repos.setUserCurrency(u.userId, code);
    await ctx.answerCallbackQuery(`Currency: ${code}`);
    await ctx.editMessageText('Now select your timezone', { reply_markup: timezoneKeyboard() });
  } else if (u.text.startsWith('tz:')) {
    const tz = u.text.slice(3);
    const option = TIMEZONES.find((t) => t.id === tz);
    if (!option) {
      await ctx.answerCallbackQuery('Unknown timezone.');
      return;
    }
    await repos.setUserTimezone(u.userId, tz);
    const settings = await repos.getUserSettings(u.userId);
    const currency = settings?.currency ?? 'INR';
    const symbol = CURRENCIES[currency]?.symbol ?? currency;
    await ctx.answerCallbackQuery('Timezone saved ✅');
    await ctx.editMessageText(
      `You're all set ✅\n\nCurrency: ${symbol} ${currency}\nTimezone: ${option.label}\n\nSend an expense like: ${symbol}450 dinner with friends`,
    );
  } else if (u.text.startsWith('del:')) {
    const [, idStr, offsetStr] = u.text.split(':');
    const id = Number(idStr);
    const offset = Number(offsetStr ?? '0');

    if (!Number.isInteger(id) || id <= 0) {
      await ctx.answerCallbackQuery('Invalid request.');
      return;
    }

    const deleted = await repos.deleteExpenseById(u.userId, id);
    await ctx.answerCallbackQuery(deleted ? 'Deleted ✅' : 'Already deleted.');
    await refreshList(bot, ctx, u.userId, Number.isInteger(offset) && offset >= 0 ? offset : 0);
  } else if (u.text.startsWith('page:')) {
    const offset = Number(u.text.split(':')[1] ?? '0');
    await ctx.answerCallbackQuery();
    await refreshList(bot, ctx, u.userId, Number.isInteger(offset) && offset >= 0 ? offset : 0);
  }
}

async function handleAuthenticatedFreeText(
  bot: Bot,
  u: NormalizedUpdate,
  currency: string,
): Promise<void> {
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
        currency,
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
      currency,
    });
    await reply(response || 'No spending found.');
  } else if (intent === 'unclear') {
    await reply(`I couldn’t understand that. Try: ${formatAmount(450, currency)} dinner with friends`);
  } else if (intent === 'log_expense') {
    await reply(
      `That sounds like an expense, but I couldn’t pick out an amount. Could you resend it like: ${formatAmount(450, currency)} dinner with friends?`,
    );
  }
}

async function handlePrivateCommand(bot: Bot, u: NormalizedUpdate, currency: string): Promise<void> {
  const reply = replier(bot, u.chatId);

  switch (u.text) {
    case '/today': {
      const { response } = await queryExpense({ userId: u.userId, period: 'today', currency });
      await reply(response || 'No spending found.');
      break;
    }
    case '/week': {
      const { response } = await queryExpense({ userId: u.userId, period: 'week', currency });
      await reply(response || 'No spending found.');
      break;
    }
    case '/month': {
      const { response } = await queryExpense({ userId: u.userId, period: 'month', currency });
      await reply(response || 'No spending found.');
      break;
    }
    case '/last': {
      const last = await repos.getLastExpense(u.userId);
      await reply(
        last
          ? `Last: ${formatAmount(last.amount, currency)} — ${last.category}: ${last.description}`
          : 'No expenses logged yet.',
      );
      break;
    }
    case '/list': {
      const { rows, total } = await repos.listRecentExpenses(u.userId, LIST_PAGE_SIZE, 0);
      if (total === 0) {
        await reply('No expenses logged yet.');
        break;
      }
      const rendered = renderExpenseList(rows, total, 0, currency);
      await bot.api.sendMessage(u.chatId, rendered.text, { reply_markup: rendered.keyboard });
      break;
    }
    case '/delete': {
      const deleted = await repos.deleteLastExpense(u.userId);
      await reply(
        deleted
          ? `Deleted ${formatAmount(deleted.amount, currency)} — ${deleted.description}`
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
    if (await repos.isRegistered(u.userId)) {
      await reply("You're already registered ✅\nSend an expense like: ₹450 dinner with friends");
      return;
    }
    await bot.api.sendMessage(
      u.chatId,
      'I can store your Telegram ID and the expenses you send me. Do you agree?',
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text('✅ I agree', 'consent:agree')
          .text('Cancel', 'consent:cancel'),
      },
    );
    return;
  }

  if (u.text === '/help') {
    await reply(
      "Expense examples:\n\n1. ₹450 dinner with friends\n2. 200 for uber\n\nCommands: \n/start - Start the bot\n/register - Register your account\n/today - View today's expenses\n/week - View this week's expenses\n/month - View this month's expenses\n/last - View your last expense\n/list - List & delete expenses\n/delete - Delete your last expense\n/export - Export your expenses as CSV\n/deleteme - Delete your account and all data\n/cancel - Cancel any pending action",
    );
    return;
  }

  if (u.text === '/start') {
    await reply(
      'Hi! 👋 I’m your expense manager bot. Send an expense like ₹450 dinner with friends, or use /register to get started.',
    );
    return;
  }

  const settings = await repos.getUserSettings(u.userId);
  if (!settings) {
    await reply('Please send /register to register first.');
    return;
  }
  const currency = settings.currency;

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
    await handlePrivateCommand(bot, u, currency);
    return;
  }

  await handleAuthenticatedFreeText(bot, u, currency);
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
