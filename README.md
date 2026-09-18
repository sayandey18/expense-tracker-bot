# Expense Bot (TypeScript)

An AI-assisted Telegram expense tracker, rebuilt from the original n8n workflow as a
modern TypeScript service.

The bot parses free-text expenses (`₹450 dinner with friends`), stores them in
PostgreSQL, and answers natural-language spending questions (`food this week`,
`total spent in August`, `last month`).

## Tech stack

| Concern        | Choice                                        |
| -------------- | --------------------------------------------- |
| Language       | TypeScript 6 (strict), ES Modules (`NodeNext`) |
| Runtime        | Node.js >= 20                                 |
| Web framework  | Fastify 5                                     |
| Telegram SDK   | grammY (latest Bot API)                       |
| ORM            | Drizzle ORM + `drizzle-kit` migrations        |
| Database       | PostgreSQL                                    |
| LLM            | DeepSeek (`/chat/completions`, JSON mode)     |
| Validation     | Zod 4                                         |
| Logging        | pino                                          |
| Lint / format  | ESLint 10 (flat config) + Prettier            |
| Deploy         | Docker + Docker Compose                       |

## Prerequisites

- Node.js >= 20
- A PostgreSQL database (existing schema is reused; no data migration needed)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- (optional) A DeepSeek API key for AI classification/clarification

## Getting started

```bash
cd typescript
npm install
cp .env.example .env      # then fill in your real values
npm run migrate           # idempotent baseline: creates tables + seeds categories
npm run dev               # tsx watch mode
```

Production build/run:

```bash
npm run build             # tsc -> dist/
npm start                 # node dist/index.js
```

The app runs migrations automatically at startup too, so `npm run migrate` is
only needed when you want to migrate without starting the server.

## Scripts

| Script            | Purpose                                              |
| ----------------- | ---------------------------------------------------- |
| `dev`             | Run with `tsx watch` (hot reload)                    |
| `build`           | Compile TypeScript to `dist/`                        |
| `start`           | Run the compiled app (`node dist/index.js`)          |
| `typecheck`       | `tsc --noEmit`                                       |
| `lint` / `lint:fix` | ESLint                                              |
| `format` / `format:check` | Prettier                                       |
| `migrate`         | Apply Drizzle migrations                             |
| `db:generate`     | Generate a migration from `src/db/schema.ts`         |
| `db:push`         | Push schema directly (dev only)                      |
| `db:studio`       | Open Drizzle Studio                                  |

## Configuration (`.env`)

| Variable                      | Required | Description                                                      |
| ----------------------------- | -------- | ---------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`          | yes      | Bot token from BotFather                                          |
| `TELEGRAM_WEBHOOK_URL`        | no       | Public HTTPS URL Telegram POSTs to (e.g. `https://bot.example.com`). The app appends `/telegram/webhook`. |
| `TELEGRAM_WEBHOOK_SECRET`     | no       | Secret token echoed by Telegram; leave empty to skip verification |
| `PORT`                        | no       | HTTP port (default `8787`)                                        |
| `LOG_LEVEL`                   | no       | pino log level (default `info`)                                   |
| `DATABASE_URL`                | yes      | PostgreSQL connection string                                      |
| `PG_SSL_REJECT_UNAUTHORIZED`  | no       | `true` = SSL off (for hosts without TLS); `false` = permissive SSL |
| `DEEPSEEK_API_KEY`            | no       | DeepSeek key (AI features degrade gracefully if missing)          |
| `DEEPSEEK_API_BASE`           | no       | Default `https://api.deepseek.com`                                |
| `DEEPSEEK_MODEL`              | no       | Default `deepseek-flash`                                          |

## How it works

On startup the app:

1. Runs Drizzle migrations (idempotent).
2. Registers the Telegram webhook via `setWebhook`.
3. Listens for `message`, `edited_message`, and `callback_query` updates.

### Commands

`/start` `/register` `/help` `/today` `/week` `/month` `/last` `/delete` `/export` `/deleteme` `/cancel`

### Message flow

1. **Rule-based parser** tries to extract an amount + category from free text
   (`₹450 dinner with friends` → `Food`). No LLM call.
2. If no amount is found, **DeepSeek classifies** the intent (`log_expense` /
   `spending_query` / `unclear` / `other`).
3. For spending queries, filters are resolved **rules-first, AI fallback**:
   - **category** (`food`, `travel`, `transport`, …) via keyword rules
   - **period** (`today`, `week`, `month`, `last-month`, `year`, `all`, …)
   - **named months** (`august`, `september 2025`) with the future-month →
     previous-year heuristic.
4. The summary is filtered in SQL and rendered as an aligned monospace table.

Examples:

```
₹450 dinner with friends        → logs an expense (Food)
food this week                  → Food total for the week
total spent in August           → August total (all categories)
how much did I spend last month → previous month total
```

### Categories (13)

`Food` `Transport` `Shopping` `Bills` `Groceries` `Entertainment` `Health`
`Other` `Education` `Fitness` `Pets` `Gifts` `Travel`

Each has an emoji (seeded into the DB) and an expanded keyword list in
`src/categories.ts`.

## Database & migrations

- Schema lives in `src/db/schema.ts` (single source of truth).
- Queries use Drizzle's typed query builder in `src/db/repos.ts` (a couple of
  aggregates use raw SQL).
- `drizzle/0000_*.sql` is a hand-written, idempotent **baseline** mirroring the
  original `CREATE TABLE IF NOT EXISTS` DDL, so running it against an existing
  database is a no-op except for seeding the new categories.
- Future schema changes: edit `schema.ts` → `npm run db:generate` → `npm run migrate`.

## Production (Docker)

The project includes a multi-stage `Dockerfile` and `docker-compose.yml`.

```bash
docker compose up -d --build
```

- Builds on `node:22-alpine`, runs as a non-root user, production deps only.
- Publishes port `8787` and health-checks `GET /health`.
- Secrets come from `.env` via `env_file` (never baked into the image).

Point your Nginx Proxy Manager proxy host at `<docker-host-ip>:8787` (scheme
`http`) for your public domain; NPM handles TLS termination.

## Project structure

```
src/
├── index.ts                    entrypoint (migrate → bot → server → setWebhook)
├── config.ts                   Zod-validated env
├── logger.ts                   pino logger
├── bot.ts                      grammY bot + update wiring
├── server.ts                   Fastify app, /health, /telegram/webhook
├── categories.ts               categories + keyword rules
├── parser.ts                   rule-based expense parser
├── deepseek.ts                 DeepSeek classify / clarify / query analysis
├── query.ts                    rule-first + AI query filter resolution
├── handlers.ts                 message routing logic
├── db/
│   ├── schema.ts               Drizzle schema
│   ├── client.ts               pg pool + drizzle instance
│   ├── repos.ts                typed query helpers
│   └── migrate.ts              standalone migration entrypoint
└── subworkflows/
    ├── logExpense.ts           validate + insert an expense
    └── queryExpense.ts         resolve period, summarize, AI-clarify
drizzle/                        migration files (baseline + meta)
```

## Notes

- **Postgres**: a plain `pg` connection string in `DATABASE_URL`. Set
  `PG_SSL_REJECT_UNAUTHORIZED=true` for hosts without TLS (e.g. SiteGround as
  configured here), or `false` to enable permissive SSL.
- **Telegram**: only the bot token is required; webhook registration is automatic.
- **DeepSeek**: uses the OpenAI-compatible `/chat/completions` endpoint with
  `response_format: json_object`. If the key is missing/invalid, classification
  falls back to `unclear` and the bot keeps working (rule-based paths are
  unaffected).
