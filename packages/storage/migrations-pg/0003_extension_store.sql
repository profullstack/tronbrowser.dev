-- TronBrowser Postgres schema: 0003_extension_store
-- Generated from packages/storage/migrations/0003_extension_store.sql with `npx libsql-pg convert-schema`, then reviewed.
-- Forward-only; scripts/db-migrate.mjs applies this directory when TRONBROWSER_DB_URL is postgres://.

-- created_at: text column with a current-time default became timestamptz
-- updated_at: text column with a current-time default became timestamptz
-- created_at: default (datetime('now')) -> now()
-- updated_at: default (datetime('now')) -> now()
create table if not exists extensions (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  owner_user_id text NOT NULL,
  name text NOT NULL,
  summary text,
  description text,
  homepage_url text,
  icon_url text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_extensions_owner  ON extensions (owner_user_id);

CREATE INDEX IF NOT EXISTS idx_extensions_status ON extensions (status, updated_at);

-- created_at: text column with a current-time default became timestamptz
-- created_at: default (datetime('now')) -> now()
create table if not exists extension_versions (
  id text PRIMARY KEY,
  extension_id text NOT NULL,
  version text NOT NULL,
  manifest_version bigint NOT NULL,
  manifest_json text NOT NULL,
  permissions_json text,
  bundle_url text,
  crx_url text,
  bundle_sha256 text,
  size_bytes bigint,
  source text NOT NULL DEFAULT 'upload',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (extension_id) REFERENCES extensions(id),
  UNIQUE (extension_id, version)
);

CREATE INDEX IF NOT EXISTS idx_ext_versions_ext ON extension_versions (extension_id, created_at DESC);

-- created_at: text column with a current-time default became timestamptz
-- created_at: default (datetime('now')) -> now()
create table if not exists extension_payments (
  id text PRIMARY KEY,
  extension_id text NOT NULL,
  user_id text NOT NULL,
  amount_cents bigint NOT NULL DEFAULT 100,
  currency text NOT NULL DEFAULT 'usd',
  method text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  provider_ref text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (extension_id) REFERENCES extensions(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ext_payments_ext  ON extension_payments (extension_id);

CREATE INDEX IF NOT EXISTS idx_ext_payments_ref  ON extension_payments (provider_ref);

-- created_at: text column with a current-time default became timestamptz
-- created_at: default (datetime('now')) -> now()
create table if not exists extension_scans (
  id text PRIMARY KEY,
  extension_id text NOT NULL,
  version_id text NOT NULL,
  provider text NOT NULL DEFAULT 'vu1nz',
  status text NOT NULL DEFAULT 'pending',
  score bigint,
  severity text,
  findings_json text,
  error text,
  scanned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (extension_id) REFERENCES extensions(id),
  FOREIGN KEY (version_id) REFERENCES extension_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_ext_scans_ext ON extension_scans (extension_id, created_at DESC);

-- created_at: text column with a current-time default became timestamptz
-- created_at: default (datetime('now')) -> now()
create table if not exists extension_flags (
  id text PRIMARY KEY,
  extension_id text NOT NULL,
  reporter_user_id text,
  reason text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (extension_id) REFERENCES extensions(id)
);

CREATE INDEX IF NOT EXISTS idx_ext_flags_ext ON extension_flags (extension_id, status);
