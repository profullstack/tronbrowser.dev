-- TronBrowser's own Web Push service (tronbrowser.dev/api/1/push).
--
-- ungoogled-chromium has no push service, so pushManager.subscribe() fails for
-- every site. The bundled extension supplies pushManager instead and registers
-- here; site servers POST standard RFC 8030/8291/8292 pushes to the endpoint we
-- hand out, and we relay the still-encrypted payload to the browser.
--
-- A device is an install of the extension, identified by the sha256 of a
-- secret only it holds: no account, no email. Payloads are stored as the
-- ciphertext the site sent; only the browser holds the key to read them.

CREATE TABLE IF NOT EXISTS push_devices (
  id            TEXT PRIMARY KEY,                     -- sha256 hex of the device secret
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  token       TEXT PRIMARY KEY,                       -- the secret last segment of the endpoint
  device_id   TEXT NOT NULL,
  origin      TEXT NOT NULL,                          -- the site that subscribed
  app_key     TEXT,                                   -- its VAPID public key (base64url), when given
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT,                                   -- kept so senders get 410, not 404
  FOREIGN KEY (device_id) REFERENCES push_devices(id)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_device ON push_subscriptions (device_id);

CREATE TABLE IF NOT EXISTS push_messages (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  body        TEXT NOT NULL,                          -- base64url ciphertext ('' for a push with no data)
  encoding    TEXT,                                   -- Content-Encoding, always aes128gcm when body is set
  urgency     TEXT NOT NULL DEFAULT 'normal',
  topic       TEXT,                                   -- a newer message with the same topic replaces it
  expires_at  INTEGER NOT NULL,                       -- unix seconds (now + TTL)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_push_messages_device ON push_messages (device_id, expires_at);
