import { Bot } from 'grammy';
import { config } from './config.js';
import { handleCallback, handleEditedMessage, handleMessage } from './handlers.js';
import { logger } from './logger.js';

export function createBot(): Bot {
  const bot = new Bot(config.telegramBotToken);

  bot.catch((err) => {
    logger.error({ err }, '[bot] unhandled update error');
  });

  bot.on('message', (ctx) => handleMessage(bot, ctx));
  bot.on('edited_message', (ctx) => handleEditedMessage(bot, ctx));
  bot.on('callback_query', (ctx) => handleCallback(bot, ctx));

  return bot;
}
