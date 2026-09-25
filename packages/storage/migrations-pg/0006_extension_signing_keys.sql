-- TronBrowser Postgres schema: 0006_extension_signing_keys
-- Generated from packages/storage/migrations/0006_extension_signing_keys.sql with `npx libsql-pg convert-schema`, then reviewed.
-- Forward-only; scripts/db-migrate.mjs applies this directory when TRONBROWSER_DB_URL is postgres://.

-- created_at: text column with a current-time default became timestamptz
-- created_at: default (datetime('now')) -> now()
create table if not exists extension_signing_keys (
  extension_id text PRIMARY KEY,
  crx_id text NOT NULL,
  public_key_der text NOT NULL,
  private_key_enc text NOT NULL,
  key_algo text NOT NULL DEFAULT 'rsa-2048',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (extension_id) REFERENCES extensions(id)
);

CREATE INDEX IF NOT EXISTS idx_signing_keys_crx_id ON extension_signing_keys(crx_id);
