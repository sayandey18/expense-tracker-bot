import { createBot } from './bot.js';
import { config } from './config.js';
import { runMigrations } from './db/client.js';
import { logger } from './logger.js';
import { buildServer, WEBHOOK_PATH } from './server.js';

async function main(): Promise<void> {
  await runMigrations();

  const bot = createBot();
  await buildServer(bot);

  if (config.telegramWebhookUrl) {
    const fullUrl = config.telegramWebhookUrl.endsWith(WEBHOOK_PATH)
      ? config.telegramWebhookUrl
      : config.telegramWebhookUrl.replace(/\/$/, '') + WEBHOOK_PATH;

    try {
      await bot.api.setWebhook(fullUrl, {
        secret_token: config.telegramWebhookSecret || undefined,
        allowed_updates: ['message', 'edited_message', 'callback_query'],
      });
      logger.info(`[telegram] webhook set to ${fullUrl}`);
    } catch (err) {
      logger.error({ err }, '[telegram] setWebhook failed');
    }
  } else {
    logger.warn('[telegram] TELEGRAM_WEBHOOK_URL not set — webhook not registered with Telegram.');
  }

  logger.info(`[server] listening on :${config.port}`);
}

main().catch((err: unknown) => {
  logger.error({ err }, '[startup] fatal error');
  process.exit(1);
});
