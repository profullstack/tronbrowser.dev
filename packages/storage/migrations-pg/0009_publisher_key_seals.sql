-- TronBrowser Postgres schema: 0009_publisher_key_seals
-- Mirrors packages/storage/migrations/0009_publisher_key_seals.sql (see there).
create table if not exists publisher_key_seals (
  user_id text PRIMARY KEY,
  seal_json text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

create table if not exists extension_signed_crx (
  version_id text PRIMARY KEY,
  extension_id text NOT NULL,
  version text NOT NULL,
  crx_b64 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signed_crx_ext ON extension_signed_crx(extension_id, created_at);
