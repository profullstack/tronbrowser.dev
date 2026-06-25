// Data access for the extension store. Mirrors the style of ../db.ts (raw
// libSQL via the shared db() client).
import { createHash, randomBytes } from 'node:crypto';
import { db, type User } from '../db.js';
import { uuid } from '../auth.js';

export interface Extension {
  id: string;
  slug: string;
  owner_user_id: string;
  name: string;
  summary: string | null;
  description: string | null;
  homepage_url: string | null;
  icon_url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ExtensionVersion {
  id: string;
  extension_id: string;
  version: string;
  manifest_version: number;
  manifest_json: string;
  permissions_json: string | null;
  bundle_url: string | null;
  crx_url: string | null;
  bundle_sha256: string | null;
  size_bytes: number | null;
  source: string;
  created_at: string;
}

export interface ExtensionScan {
  id: string;
  extension_id: string;
  version_id: string;
  provider: string;
  status: string;
  score: number | null;
  severity: string | null;
  findings_json: string | null;
  error: string | null;
  scanned_at: string | null;
  created_at: string;
}

export async function createExtension(x: {
  ownerUserId: string;
  slug: string;
  name: string;
  summary?: string | null;
  description?: string | null;
  homepageUrl?: string | null;
  iconUrl?: string | null;
}): Promise<Extension> {
  const id = uuid();
  await db().execute({
    sql: `INSERT INTO extensions (id, slug, owner_user_id, name, summary, description, homepage_url, icon_url, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    args: [id, x.slug, x.ownerUserId, x.name, x.summary ?? null, x.description ?? null, x.homepageUrl ?? null, x.iconUrl ?? null],
  });
  return (await extensionById(id))!;
}

export async function extensionById(id: string): Promise<Extension | null> {
  const r = await db().execute({ sql: 'SELECT * FROM extensions WHERE id = ?', args: [id] });
  return (r.rows[0] as unknown as Extension) ?? null;
}

export async function extensionBySlug(slug: string): Promise<Extension | null> {
  const r = await db().execute({ sql: 'SELECT * FROM extensions WHERE slug = ?', args: [slug] });
  return (r.rows[0] as unknown as Extension) ?? null;
}

export async function slugTaken(slug: string): Promise<boolean> {
  const r = await db().execute({ sql: 'SELECT 1 FROM extensions WHERE slug = ?', args: [slug] });
  return r.rows.length > 0;
}

export async function listLiveExtensions(opts: { q?: string | undefined; limit?: number; offset?: number } = {}): Promise<Extension[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  if (opts.q) {
    const like = `%${opts.q}%`;
    const r = await db().execute({
      sql: `SELECT * FROM extensions WHERE status = 'live' AND (name LIKE ? OR summary LIKE ?)
            ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      args: [like, like, limit, offset],
    });
    return r.rows as unknown as Extension[];
  }
  const r = await db().execute({
    sql: `SELECT * FROM extensions WHERE status = 'live' ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    args: [limit, offset],
  });
  return r.rows as unknown as Extension[];
}

export async function setExtensionStatus(id: string, status: string): Promise<void> {
  await db().execute({
    sql: `UPDATE extensions SET status = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [status, id],
  });
}

export async function addVersion(v: {
  extensionId: string;
  version: string;
  manifestVersion: number;
  manifestJson: string;
  permissions: string[];
  bundleUrl?: string | null;
  crxUrl?: string | null;
  bundleSha256?: string | null;
  sizeBytes?: number | null;
  source?: 'upload' | 'pr';
}): Promise<ExtensionVersion> {
  const id = uuid();
  await db().execute({
    sql: `INSERT INTO extension_versions
          (id, extension_id, version, manifest_version, manifest_json, permissions_json, bundle_url, crx_url, bundle_sha256, size_bytes, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, v.extensionId, v.version, v.manifestVersion, v.manifestJson,
      JSON.stringify(v.permissions ?? []), v.bundleUrl ?? null, v.crxUrl ?? null,
      v.bundleSha256 ?? null, v.sizeBytes ?? null, v.source ?? 'upload',
    ],
  });
  const r = await db().execute({ sql: 'SELECT * FROM extension_versions WHERE id = ?', args: [id] });
  return r.rows[0] as unknown as ExtensionVersion;
}

export async function latestVersion(extensionId: string): Promise<ExtensionVersion | null> {
  const r = await db().execute({
    sql: `SELECT * FROM extension_versions WHERE extension_id = ? ORDER BY created_at DESC LIMIT 1`,
    args: [extensionId],
  });
  return (r.rows[0] as unknown as ExtensionVersion) ?? null;
}

/* ---------- payments ---------- */

export async function createPayment(p: {
  extensionId: string;
  userId: string;
  method: 'stripe' | 'coinpay' | 'x402';
  amountCents?: number;
  currency?: string;
  providerRef?: string | null;
}): Promise<string> {
  const id = uuid();
  await db().execute({
    sql: `INSERT INTO extension_payments (id, extension_id, user_id, amount_cents, currency, method, status, provider_ref)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    args: [id, p.extensionId, p.userId, p.amountCents ?? 100, p.currency ?? 'usd', p.method, p.providerRef ?? null],
  });
  return id;
}

export async function setPaymentRef(id: string, providerRef: string): Promise<void> {
  await db().execute({ sql: `UPDATE extension_payments SET provider_ref = ? WHERE id = ?`, args: [providerRef, id] });
}

export async function markPaidByRef(providerRef: string): Promise<string | null> {
  const r = await db().execute({
    sql: `UPDATE extension_payments SET status = 'paid', paid_at = datetime('now')
          WHERE provider_ref = ? AND status != 'paid' RETURNING extension_id`,
    args: [providerRef],
  });
  return (r.rows[0]?.extension_id as string) ?? null;
}

export async function hasPaidListing(extensionId: string): Promise<boolean> {
  const r = await db().execute({
    sql: `SELECT 1 FROM extension_payments WHERE extension_id = ? AND status = 'paid' LIMIT 1`,
    args: [extensionId],
  });
  return r.rows.length > 0;
}

/* ---------- scans ---------- */

export async function createScan(extensionId: string, versionId: string): Promise<string> {
  const id = uuid();
  await db().execute({
    sql: `INSERT INTO extension_scans (id, extension_id, version_id, status) VALUES (?, ?, ?, 'pending')`,
    args: [id, extensionId, versionId],
  });
  return id;
}

export async function updateScan(id: string, patch: {
  status: string;
  score?: number | null;
  severity?: string | null;
  findingsJson?: string | null;
  error?: string | null;
}): Promise<void> {
  await db().execute({
    sql: `UPDATE extension_scans
          SET status = ?, score = ?, severity = ?, findings_json = ?, error = ?, scanned_at = datetime('now')
          WHERE id = ?`,
    args: [patch.status, patch.score ?? null, patch.severity ?? null, patch.findingsJson ?? null, patch.error ?? null, id],
  });
}

export async function latestScan(extensionId: string): Promise<ExtensionScan | null> {
  const r = await db().execute({
    sql: `SELECT * FROM extension_scans WHERE extension_id = ? ORDER BY created_at DESC LIMIT 1`,
    args: [extensionId],
  });
  return (r.rows[0] as unknown as ExtensionScan) ?? null;
}

/* ---------- flags ---------- */

export async function addFlag(f: {
  extensionId: string;
  reporterUserId?: string | null;
  reason: string;
  detail?: string | null;
}): Promise<void> {
  await db().execute({
    sql: `INSERT INTO extension_flags (id, extension_id, reporter_user_id, reason, detail) VALUES (?, ?, ?, ?, ?)`,
    args: [uuid(), f.extensionId, f.reporterUserId ?? null, f.reason, f.detail ?? null],
  });
}

export async function openFlagCount(extensionId: string): Promise<number> {
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM extension_flags WHERE extension_id = ? AND status = 'open'`,
    args: [extensionId],
  });
  return Number(r.rows[0]?.n ?? 0);
}

/* ---------- publisher SSH identity (files.profullstack.com) ---------- */

export interface PublisherKey {
  user_id: string;
  handle: string;
  pubkey: string;
  fingerprint: string;
  provisioned_at: string | null;
  created_at: string;
}

export async function publisherKey(userId: string): Promise<PublisherKey | null> {
  const r = await db().execute({ sql: 'SELECT * FROM publisher_keys WHERE user_id = ?', args: [userId] });
  return (r.rows[0] as unknown as PublisherKey) ?? null;
}

export async function handleTaken(handle: string, exceptUserId: string): Promise<boolean> {
  const r = await db().execute({
    sql: 'SELECT 1 FROM publisher_keys WHERE handle = ? AND user_id != ?',
    args: [handle, exceptUserId],
  });
  return r.rows.length > 0;
}

export async function upsertPublisherKey(k: {
  userId: string;
  handle: string;
  pubkey: string;
  fingerprint: string;
  provisioned: boolean;
}): Promise<void> {
  await db().execute({
    sql: `INSERT INTO publisher_keys (user_id, handle, pubkey, fingerprint, provisioned_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            handle = excluded.handle, pubkey = excluded.pubkey,
            fingerprint = excluded.fingerprint, provisioned_at = excluded.provisioned_at`,
    args: [k.userId, k.handle, k.pubkey, k.fingerprint, k.provisioned ? new Date().toISOString() : null],
  });
}

/* ---------- publisher API tokens (headless / CI publishing) ---------- */

export interface PublisherToken {
  id: string;
  user_id: string;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
}

const TOKEN_PREFIX = 'tbpub_';
const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

/** Mint a long-lived publisher token. Returns the RAW token (shown once). */
export async function createPublisherToken(
  userId: string,
  name?: string | null,
): Promise<{ token: string; id: string; name: string | null }> {
  const token = TOKEN_PREFIX + randomBytes(24).toString('base64url');
  const id = uuid();
  await db().execute({
    sql: 'INSERT INTO publisher_tokens (id, user_id, token_hash, name) VALUES (?, ?, ?, ?)',
    args: [id, userId, hashToken(token), name ?? null],
  });
  return { token, id, name: name ?? null };
}

/** Resolve a raw `tbpub_…` token to its user, stamping last_used_at. */
export async function userByPublisherToken(raw: string): Promise<User | null> {
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const hash = hashToken(raw);
  const r = await db().execute({ sql: 'SELECT user_id FROM publisher_tokens WHERE token_hash = ?', args: [hash] });
  const row = r.rows[0];
  if (!row) return null;
  await db().execute({ sql: "UPDATE publisher_tokens SET last_used_at = datetime('now') WHERE token_hash = ?", args: [hash] });
  const u = await db().execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [String(row.user_id)] });
  return (u.rows[0] as unknown as User) ?? null;
}

export async function listPublisherTokens(userId: string): Promise<PublisherToken[]> {
  const r = await db().execute({
    sql: 'SELECT id, user_id, name, created_at, last_used_at FROM publisher_tokens WHERE user_id = ? ORDER BY created_at DESC',
    args: [userId],
  });
  return r.rows as unknown as PublisherToken[];
}

export async function revokePublisherToken(userId: string, id: string): Promise<boolean> {
  const r = await db().execute({ sql: 'DELETE FROM publisher_tokens WHERE id = ? AND user_id = ?', args: [id, userId] });
  return (r.rowsAffected ?? 0) > 0;
}
