import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv({ quiet: true });

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_URL: z
    .string()
    .refine((value) => value === '' || URL.canParse(value), 'must be a valid URL')
    .optional()
    .default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional().default(''),
  PORT: z.string().regex(/^\d+$/, 'must be a positive integer').transform(Number).default(8787),
  DATABASE_URL: z.string().min(1),
  PG_SSL_REJECT_UNAUTHORIZED: z.enum(['true', 'false']).optional(),
  DEEPSEEK_API_KEY: z.string().optional().default(''),
  DEEPSEEK_API_BASE: z
    .string()
    .refine((value) => URL.canParse(value), 'must be a valid URL')
    .optional()
    .default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().optional().default('deepseek-flash'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  throw new Error(
    '[config] invalid environment configuration:\n' +
      result.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n'),
  );
}

const env = result.data;

export const config = {
  telegramBotToken: env.TELEGRAM_BOT_TOKEN,
  telegramWebhookUrl: env.TELEGRAM_WEBHOOK_URL,
  telegramWebhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  pgSslRejectUnauthorized: env.PG_SSL_REJECT_UNAUTHORIZED,
  deepseekApiKey: env.DEEPSEEK_API_KEY,
  deepseekApiBase: env.DEEPSEEK_API_BASE,
  deepseekModel: env.DEEPSEEK_MODEL,
} as const;
