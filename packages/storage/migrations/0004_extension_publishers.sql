-- Publisher SSH identity for the extension store.
--
-- Bundles (.crx/.zip) are hosted on files.profullstack.com — the AgentBBS Files
-- area — which is reached over SFTP and keyed by SSH public key. So each store
-- publisher gets one AgentBBS member identity provisioned from their SSH public
-- key (see agentbbs `provision-user`). They then upload with:
--   scp dist.crx files@files.profullstack.com:/public/extensions/<slug>/
-- and the file is served at https://files.profullstack.com/public/extensions/...
--
-- We store only the PUBLIC key. If the store generated the keypair for them, the
-- private key is shown once at creation and never persisted.

CREATE TABLE IF NOT EXISTS publisher_keys (
  user_id        TEXT    PRIMARY KEY,                 -- users.id (one BBS identity per store user)
  handle         TEXT    NOT NULL UNIQUE,             -- AgentBBS member handle (a-z0-9-, 3-20)
  pubkey         TEXT    NOT NULL,                     -- SSH public key (authorized_keys line)
  fingerprint    TEXT    NOT NULL,                     -- SHA256 fp returned by provisioning
  provisioned_at TEXT,                                 -- set when agentbbs provision-user succeeded
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_publisher_keys_handle ON publisher_keys (handle);
