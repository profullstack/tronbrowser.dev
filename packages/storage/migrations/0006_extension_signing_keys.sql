-- CRX signing keys, one per extension.
--
-- Chromium can only install a signed .crx; a .zip is sideload-only. Publishers
-- shouldn't have to run openssl and mind a .pem forever, so the store holds the
-- key and packs the .crx on demand.
--
-- The key permanently determines the extension id (it is the SHA-256 of the
-- public key), so a row here is effectively immutable: rotating it would orphan
-- every existing install. Hence PRIMARY KEY on extension_id and no update path.
--
-- private_key_enc is AES-256-GCM, keyed by CRX_KEY_SECRET — never plaintext.
CREATE TABLE IF NOT EXISTS extension_signing_keys (
  extension_id    TEXT    PRIMARY KEY,                  -- extensions.id
  crx_id          TEXT    NOT NULL,                     -- 32-char a-p Chromium extension id
  public_key_der  TEXT    NOT NULL,                     -- base64 SPKI DER
  private_key_enc TEXT    NOT NULL,                     -- base64 iv:tag:ciphertext (AES-256-GCM)
  key_algo        TEXT    NOT NULL DEFAULT 'rsa-2048',
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (extension_id) REFERENCES extensions(id)
);

CREATE INDEX IF NOT EXISTS idx_signing_keys_crx_id ON extension_signing_keys(crx_id);
