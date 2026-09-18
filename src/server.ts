import Fastify from 'fastify';
import { webhookCallback, type Bot } from 'grammy';
import { config } from './config.js';
import { logger } from './logger.js';

export const WEBHOOK_PATH = '/telegram/webhook';

export async function buildServer(bot: Bot) {
  const app = Fastify({ loggerInstance: logger });

  app.get('/health', async () => ({ ok: true }));

  app.post(
    WEBHOOK_PATH,
    webhookCallback(bot, 'fastify', {
      secretToken: config.telegramWebhookSecret || undefined,
    }),
  );

  await app.listen({ port: config.port, host: '0.0.0.0' });

  return app;
}
