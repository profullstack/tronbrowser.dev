-- TronBrowser Postgres schema: 0002_accounts_settings
-- Generated from packages/storage/migrations/0002_accounts_settings.sql with `npx libsql-pg convert-schema`, then reviewed.
-- Forward-only; scripts/db-migrate.mjs applies this directory when TRONBROWSER_DB_URL is postgres://.

-- created_at: text column with a current-time default became timestamptz
-- updated_at: text column with a current-time default became timestamptz
-- created_at: default (datetime('now')) -> now()
-- updated_at: default (datetime('now')) -> now()
create table if not exists users (
  id text PRIMARY KEY,
  auth_method text NOT NULL DEFAULT 'coinpay',
  coinpay_sub text UNIQUE,
  email text UNIQUE,
  email_verified bigint NOT NULL DEFAULT 0,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- updated_at: text column with a current-time default became timestamptz
-- updated_at: default (datetime('now')) -> now()
create table if not exists user_settings (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings text NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- created_at: text column with a current-time default became timestamptz
-- created_at: default (datetime('now')) -> now()
create table if not exists email_tokens (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  -- written as now() + interval and compared with now(): timestamptz, not text
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- created_at: text column with a current-time default became timestamptz
-- created_at: default (datetime('now')) -> now()
create table if not exists sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- written as now() + interval and compared with now(): timestamptz, not text
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
