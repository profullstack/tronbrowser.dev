-- TronBrowser Postgres schema: 0001_ai_provider_keys
-- Generated from packages/storage/migrations/0001_ai_provider_keys.sql with `npx libsql-pg convert-schema`, then reviewed.
-- Forward-only; scripts/db-migrate.mjs applies this directory when TRONBROWSER_DB_URL is postgres://.

-- created_at: text column with a current-time default became timestamptz
-- updated_at: text column with a current-time default became timestamptz
-- created_at: default (datetime('now')) -> now()
-- updated_at: default (datetime('now')) -> now()
create table if not exists ai_provider_keys (
  app_id text NOT NULL,
  provider text NOT NULL,
  api_key text NOT NULL,
  enabled bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_keys_app
  ON ai_provider_keys (app_id)
  WHERE enabled = 1;
