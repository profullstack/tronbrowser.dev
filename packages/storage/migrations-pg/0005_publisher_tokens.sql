-- TronBrowser Postgres schema: 0005_publisher_tokens
-- Generated from packages/storage/migrations/0005_publisher_tokens.sql with `npx libsql-pg convert-schema`, then reviewed.
-- Forward-only; scripts/db-migrate.mjs applies this directory when TRONBROWSER_DB_URL is postgres://.

-- created_at: text column with a current-time default became timestamptz
-- created_at: default (datetime('now')) -> now()
create table if not exists publisher_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_publisher_tokens_user ON publisher_tokens (user_id);
