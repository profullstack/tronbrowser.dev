-- Long-lived publisher API tokens for headless / CI publishing.
--
-- A publisher mints a token in the web UI (shown once) and stores it as a CI
-- secret. CI then sends it as `Authorization: Bearer tbpub_...` to push new
-- extension versions without a browser session. We store only the SHA-256 hash
-- of the token, never the token itself.

CREATE TABLE IF NOT EXISTS publisher_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,                 -- sha256 hex of the raw token
  name          TEXT,                                 -- human label, e.g. "github-actions"
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_publisher_tokens_user ON publisher_tokens (user_id);
