CREATE TABLE IF NOT EXISTS "users" (
	"telegram_user_id" bigint PRIMARY KEY NOT NULL,
	"telegram_chat_id" bigint NOT NULL,
	"username" text,
	"first_name" text,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"consent_given_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "categories" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
INSERT INTO "categories" ("name", "emoji") VALUES
  ('Food','🍽️'),('Transport','🚕'),('Shopping','🛍️'),('Bills','🧾'),
  ('Groceries','🛒'),('Entertainment','🎬'),('Health','💊'),('Other','📦'),
  ('Education','📚'),('Fitness','💪'),('Pets','🐾'),('Gifts','🎁'),('Travel','✈️')
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expenses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL REFERENCES "users"("telegram_user_id"),
	"amount" numeric(12, 2) NOT NULL,
	"category_id" smallint NOT NULL REFERENCES "categories"("id"),
	"description" text,
	"raw_message" text NOT NULL,
	"telegram_message_id" bigint,
	"spent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_check" CHECK ("amount" > 0 AND "amount" < 10000000),
	CONSTRAINT "expenses_user_id_telegram_message_id_unique" UNIQUE("user_id","telegram_message_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expenses_user_month" ON "expenses" USING btree ("user_id","spent_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limit_counters" (
	"user_id" bigint NOT NULL REFERENCES "users"("telegram_user_id"),
	"window_start" timestamp with time zone NOT NULL,
	"msg_count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_limit_counters_user_id_window_start_pk" PRIMARY KEY("user_id","window_start")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL REFERENCES "users"("telegram_user_id"),
	"plan" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"provider" text,
	"provider_ref" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_parse_failures" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint,
	"raw_message" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
