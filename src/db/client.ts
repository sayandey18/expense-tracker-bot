import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';
import * as schema from './schema.js';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.pgSslRejectUnauthorized === 'false' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  logger.error({ err }, '[db] unexpected pool error');
});

export const db = drizzle(pool, { schema });

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  logger.info('[db] migration complete');
}
