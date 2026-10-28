-- Seal v2 for CRX signing keys.
--
-- A publisher's signing keys are sealed under a passphrase only they know
-- (apps/extensions/public/seal.js). This table holds the publisher's seal
-- record: KDF params + salt + the wrapped data key + a key check. Nothing in
-- it opens anything. extension_signing_keys.private_key_enc values starting
-- with 'v2:' are sealed under that data key; anything else is a legacy
-- CRX_KEY_SECRET value awaiting the publisher's one-shot migration.
CREATE TABLE IF NOT EXISTS publisher_key_seals (
  user_id     TEXT PRIMARY KEY,
  seal_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The .crx is packed when the publisher is present (publish / sign), and the
-- packed bytes are served from here. The store never packs on download.
CREATE TABLE IF NOT EXISTS extension_signed_crx (
  version_id   TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL,
  version      TEXT NOT NULL,
  crx_b64      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_signed_crx_ext ON extension_signed_crx(extension_id, created_at);
