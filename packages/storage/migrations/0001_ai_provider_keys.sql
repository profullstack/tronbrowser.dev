-- Cloud (paid) AI provider keys — OUR keys, used by the managed cloud tier.
-- Scoped by app_id because Profullstack runs multiple apps off one key vault
-- (tronbrowser, crawlproof, …). BYOK keys are NOT stored here; users keep those
-- in their own env/store.

CREATE TABLE IF NOT EXISTS ai_provider_keys (
  app_id     TEXT    NOT NULL,                       -- 'tronbrowser' | 'crawlproof' | …
  provider   TEXT    NOT NULL,                       -- 'anthropic' | 'openai' | 'google' |
                                                     -- 'deepseek' | 'perplexity' | 'huggingface' |
                                                     -- 'kimi' | 'qwen'
  api_key    TEXT    NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (app_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_keys_app
  ON ai_provider_keys (app_id)
  WHERE enabled = 1;
