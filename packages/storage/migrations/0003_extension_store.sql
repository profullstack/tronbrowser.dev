-- TronBrowser Extension Store ("tronbrowser.dev/store").
--
-- A pay-$1-to-list extension store that keeps Chromium's actual plumbing —
-- Manifest V3 bundles, CRX3 packaging, and the gupdate `update_url` XML — but
-- drops the Web Store bureaucracy (review queue, $5 dev fee, screenshots,
-- multi-day waits). Listings go LIVE instantly once the $1 fee is paid; a
-- vu1nz.com security scan runs asynchronously and surfaces as a badge, and the
-- community can flag bad extensions after the fact.
--
-- Turso/libSQL is the source of truth (instant publish); each published listing
-- is also mirrored to a public git registry repo for an auditable trail.

CREATE TABLE IF NOT EXISTS extensions (
  id            TEXT    PRIMARY KEY,                  -- uuid
  slug          TEXT    NOT NULL UNIQUE,              -- url-safe, derived from name
  owner_user_id TEXT    NOT NULL,                     -- users.id (publisher)
  name          TEXT    NOT NULL,
  summary       TEXT,                                 -- one-line tagline
  description   TEXT,                                 -- markdown
  homepage_url  TEXT,
  icon_url      TEXT,
  status        TEXT    NOT NULL DEFAULT 'draft',     -- 'draft' | 'live' | 'removed'
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_extensions_owner  ON extensions (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_extensions_status ON extensions (status, updated_at);

-- One row per uploaded/submitted version. We keep Chromium's format intact:
-- manifest_version MUST be 3, and `crx_url`/`bundle_url` are the hosted
-- artifacts the gupdate XML points a browser at for install + auto-update.
CREATE TABLE IF NOT EXISTS extension_versions (
  id               TEXT    PRIMARY KEY,
  extension_id     TEXT    NOT NULL,
  version          TEXT    NOT NULL,                  -- semver from manifest.version
  manifest_version INTEGER NOT NULL,                  -- enforced = 3 at the app layer
  manifest_json    TEXT    NOT NULL,                  -- the full manifest.json
  permissions_json TEXT,                              -- extracted permissions[] (for display + scan)
  bundle_url       TEXT,                              -- hosted .zip (unpacked / sideload)
  crx_url          TEXT,                              -- hosted .crx3 (Chromium install + update)
  bundle_sha256    TEXT,
  size_bytes       INTEGER,
  source           TEXT    NOT NULL DEFAULT 'upload', -- 'upload' | 'pr'
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (extension_id) REFERENCES extensions(id),
  UNIQUE (extension_id, version)
);

CREATE INDEX IF NOT EXISTS idx_ext_versions_ext ON extension_versions (extension_id, created_at DESC);

-- The $1 pay-to-list fee. Paid via Stripe OR CoinPay/x402. A listing only goes
-- 'live' once a matching row reaches status 'paid'.
CREATE TABLE IF NOT EXISTS extension_payments (
  id           TEXT    PRIMARY KEY,
  extension_id TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 100,          -- $1.00
  currency     TEXT    NOT NULL DEFAULT 'usd',
  method       TEXT    NOT NULL,                      -- 'stripe' | 'coinpay' | 'x402'
  status       TEXT    NOT NULL DEFAULT 'pending',    -- 'pending' | 'paid' | 'failed'
  provider_ref TEXT,                                  -- stripe session id / coinpay reference
  paid_at      TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (extension_id) REFERENCES extensions(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ext_payments_ext  ON extension_payments (extension_id);
CREATE INDEX IF NOT EXISTS idx_ext_payments_ref  ON extension_payments (provider_ref);

-- Asynchronous vu1nz.com security scan results. Non-gating: a listing is live
-- before this completes; the score/findings render as a badge on the listing.
CREATE TABLE IF NOT EXISTS extension_scans (
  id           TEXT    PRIMARY KEY,
  extension_id TEXT    NOT NULL,
  version_id   TEXT    NOT NULL,
  provider     TEXT    NOT NULL DEFAULT 'vu1nz',
  status       TEXT    NOT NULL DEFAULT 'pending',    -- 'pending' | 'running' | 'done' | 'error' | 'skipped'
  score        INTEGER,                               -- 0-100 (higher = safer); NULL until done
  severity     TEXT,                                  -- 'clean' | 'low' | 'medium' | 'high' | 'critical'
  findings_json TEXT,                                 -- vu1nz findings payload
  error        TEXT,
  scanned_at   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (extension_id) REFERENCES extensions(id),
  FOREIGN KEY (version_id) REFERENCES extension_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_ext_scans_ext ON extension_scans (extension_id, created_at DESC);

-- Community flagging (the "+ flagging" half of "scan + community flagging").
CREATE TABLE IF NOT EXISTS extension_flags (
  id              TEXT    PRIMARY KEY,
  extension_id    TEXT    NOT NULL,
  reporter_user_id TEXT,                              -- nullable: anonymous flags allowed
  reason          TEXT    NOT NULL,                   -- 'malware' | 'privacy' | 'broken' | 'spam' | 'other'
  detail          TEXT,
  status          TEXT    NOT NULL DEFAULT 'open',    -- 'open' | 'resolved' | 'dismissed'
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (extension_id) REFERENCES extensions(id)
);

CREATE INDEX IF NOT EXISTS idx_ext_flags_ext ON extension_flags (extension_id, status);
