-- TronBrowser accounts + synced settings, stored in the cloud SQLite (Turso) DB.
--
-- Two auth methods, CoinPay OAuth PREFERRED:
--   1. CoinPay OAuth — fully anonymous (identified by the CoinPay subject id).
--   2. Email + password — with email verification.
-- Email is OPTIONAL for CoinPay accounts, REQUIRED for password accounts.
-- Never Google.

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,                       -- uuid
  auth_method    TEXT NOT NULL DEFAULT 'coinpay',        -- 'coinpay' | 'password'
  coinpay_sub    TEXT UNIQUE,                            -- CoinPay subject (oauth), nullable
  email          TEXT UNIQUE,                            -- optional for coinpay, required for password
  email_verified INTEGER NOT NULL DEFAULT 0,
  password_hash  TEXT,                                   -- argon2/bcrypt; NULL for coinpay-only
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One synced settings blob per user (aiConfig, feeds/OPML, coinpayConfig, prefs).
CREATE TABLE IF NOT EXISTS user_settings (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings   TEXT NOT NULL DEFAULT '{}',                 -- JSON
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Email verification + password-reset tokens.
CREATE TABLE IF NOT EXISTS email_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL,                              -- 'verify' | 'reset'
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions (bearer tokens) for both auth methods.
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
