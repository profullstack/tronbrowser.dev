-- TronBrowser Postgres schema: 0007_push
-- Generated from packages/storage/migrations/0007_push.sql with `npx libsql-pg convert-schema`, then reviewed.
-- Forward-only; scripts/db-migrate.mjs applies this directory when TRONBROWSER_DB_URL is postgres://.

-- created_at: text column with a current-time default became timestamptz
-- last_seen_at: text column with a current-time default became timestamptz
-- created_at: default (datetime('now')) -> now()
-- last_seen_at: default (datetime('now')) -> now()
create table if not exists push_devices (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- created_at: text column with a current-time default became timestamptz
-- created_at: default (datetime('now')) -> now()
create table if not exists push_subscriptions (
  token text PRIMARY KEY,
  device_id text NOT NULL,
  origin text NOT NULL,
  app_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (device_id) REFERENCES push_devices(id)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_device ON push_subscriptions (device_id);

-- created_at: text column with a current-time default became timestamptz
-- created_at: default (datetime('now')) -> now()
create table if not exists push_messages (
  id text PRIMARY KEY,
  token text NOT NULL,
  device_id text NOT NULL,
  body text NOT NULL,
  encoding text,
  urgency text NOT NULL DEFAULT 'normal',
  topic text,
  expires_at bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_messages_device ON push_messages (device_id, expires_at);
