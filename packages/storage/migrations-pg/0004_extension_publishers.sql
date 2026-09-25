-- TronBrowser Postgres schema: 0004_extension_publishers
-- Generated from packages/storage/migrations/0004_extension_publishers.sql with `npx libsql-pg convert-schema`, then reviewed.
-- Forward-only; scripts/db-migrate.mjs applies this directory when TRONBROWSER_DB_URL is postgres://.

-- created_at: text column with a current-time default became timestamptz
-- created_at: default (datetime('now')) -> now()
create table if not exists publisher_keys (
  user_id text PRIMARY KEY,
  handle text NOT NULL UNIQUE,
  pubkey text NOT NULL,
  fingerprint text NOT NULL,
  provisioned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_publisher_keys_handle ON publisher_keys (handle);
