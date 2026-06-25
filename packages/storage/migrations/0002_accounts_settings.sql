-- TronBrowser accounts + synced settings, stored in the cloud SQLite (Turso) DB.
--
-- Accounts are FULLY ANONYMOUS: a user is identified only by their CoinPay OAuth
-- subject id. Email is OPTIONAL (collected only if the user provides it on signup).
-- All auth is CoinPay OAuth — never Google.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,                 -- CoinPay OAuth subject (sub)
  email       TEXT,                             -- optional, may be NULL
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One synced settings blob per user (aiConfig, feeds/OPML, coinpayConfig, prefs).
CREATE TABLE IF NOT EXISTS user_settings (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings    TEXT NOT NULL DEFAULT '{}',       -- JSON
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email IS NOT NULL;
