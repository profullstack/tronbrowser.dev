// Extension store routes, mounted at /api/store by services/api/src/index.ts.
//
// Flow: create draft -> submit MV3 version (upload or PR) -> pay $1 (CoinPay
// hosted checkout: any coin or PayPal) -> listing goes LIVE instantly + git mirror + async vu1nz scan.
// Chromium install/auto-update keeps working via /api/store/updates.xml.
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { userBySession, type User } from '../db.js';
import {
  createExtension, extensionById, extensionBySlug, slugTaken, listLiveExtensions,
  setExtensionStatus, addVersion, latestVersion, createPayment, setPaymentRef,
  markPaidByRef, markPaidById, hasPaidListing, latestScan, addFlag, openFlagCount,
  publisherKey, handleTaken, upsertPublisherKey,
  createPublisherToken, userByPublisherToken, listPublisherTokens, revokePublisherToken,
  updateExtension, signingKeyFor, insertSigningKey,
  publisherSeal, savePublisherSeal, replaceSigningKeyCiphertext, extensionsOwnedBy,
  saveSignedCrx, latestSignedCrx,
} from './db.js';
import { validateManifest, slugify } from './manifest.js';
import {
  provisionPublisher, generateKeypair, publicUrlFor, scpCommand, artifactExists, SCP_TARGET,
} from './fileshost.js';
import { createListingCheckout, listingSessionPaid, readListingWebhook } from './payments.js';
import { enqueueScan } from './vu1nz.js';
import { mirrorListing } from './mirror.js';
import { fetchArtifact, artifactToZip, extractListingFromCrx, stampUpdateUrl } from './crx.js';
import { scanArtifact, type ExtensionScanResult } from './scanner.js';
import {
  generateSigningKey, packCrx, isPublisherSeal, verifyDataKey, sealPrivateKey, openPrivateKey,
  isSealedKey, legacyDecryptPrivateKey, legacyMigrationEnabled, type PublisherSeal,
} from './signing.js';
import { createScan, updateScan } from './db.js';

const APP_URL = process.env.APP_URL || 'https://tronbrowser.dev';

async function currentUser(c: any): Promise<User | null> {
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  // Long-lived publisher API tokens (CI) are distinguishable by prefix; anything
  // else in the bearer position is treated as a normal session token.
  if (bearer?.startsWith('tbpub_')) return userByPublisherToken(bearer);
  const sess = bearer || getCookie(c, 'tb_session');
  return sess ? userBySession(sess) : null;
}

/** A user resolved from a browser SESSION only (not an API token). */
async function sessionUser(c: any): Promise<User | null> {
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (bearer?.startsWith('tbpub_')) return null;
  return currentUser(c);
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch]!));
}

// Make a public listing view (no owner internals), with scan + flag summary.
// `viewer` is optional: when the signed-in user owns the listing we say so, so
// the detail page can offer an edit form instead of making them reach for curl.
async function listingView(ext: any, viewer?: User | null) {
  const [ver, scan, flags, key] = await Promise.all([
    latestVersion(ext.id),
    latestScan(ext.id),
    openFlagCount(ext.id),
    signingKeyFor(ext.id),
  ]);
  return {
    id: ext.id,
    slug: ext.slug,
    name: ext.name,
    summary: ext.summary,
    description: ext.description,
    homepageUrl: ext.homepage_url,
    iconUrl: ext.icon_url,
    status: ext.status,
    updatedAt: ext.updated_at,
    version: ver ? {
      version: ver.version,
      manifestVersion: ver.manifest_version,
      permissions: ver.permissions_json ? JSON.parse(ver.permissions_json) : [],
      bundleUrl: ver.bundle_url,
      crxUrl: ver.crx_url,
      sizeBytes: ver.size_bytes,
      source: ver.source,
    } : null,
    scan: scan ? { status: scan.status, score: scan.score, severity: scan.severity } : null,
    flags,
    isOwner: !!viewer && viewer.id === ext.owner_user_id,
    // Present once the listing has a signing key: the Chromium extension id, and
    // a real (installable) .crx instead of a zip the browser can only download.
    crxId: key?.crx_id ?? null,
    // Owner-only: the public key for manifest.json "key". Public by nature, but
    // there's no reason to hand every visitor a listing's signing material.
    crxPublicKey: key && viewer && viewer.id === ext.owner_user_id ? key.public_key_der : null,
    installUrl: key && ver
      ? `${APP_URL}/api/store/extensions/${ext.slug}/download.crx`
      : ver ? `${APP_URL}/api/store/extensions/${ext.slug}/download` : null,
    updateUrl: `${APP_URL}/api/store/updates.xml?id=${ext.id}`,
  };
}

/** Write a scan verdict to the badge store. Shared by publish and rescan. */
async function persistScan(extensionId: string, versionId: string, result: ExtensionScanResult): Promise<void> {
  const scanId = await createScan(extensionId, versionId);
  await updateScan(scanId, {
    status: 'done',
    score: result.green ? 100 : 40,
    severity: result.status === 'malicious' ? 'critical' : result.status === 'suspicious' ? 'high' : 'clean',
    findingsJson: JSON.stringify(result.findings),
  });
}

export const store = new Hono();

store.get('/healthz', (c) => c.json({ ok: true, service: 'store' }));

/* ---------- browse ---------- */
store.get('/extensions', async (c) => {
  const q = c.req.query('q') || undefined;
  const limit = Number(c.req.query('limit') || 50);
  const offset = Number(c.req.query('offset') || 0);
  const rows = await listLiveExtensions({ q, limit, offset });
  // Point-free .map would hand the array index in as `viewer`.
  return c.json({ extensions: await Promise.all(rows.map((row) => listingView(row))) });
});

store.get('/extensions/:slug', async (c) => {
  const ext = await extensionBySlug(c.req.param('slug'));
  if (!ext || ext.status === 'removed') return c.json({ error: 'not found' }, 404);
  return c.json(await listingView(ext, await currentUser(c).catch(() => null)));
});

/* ---------- publisher: edit listing copy ----------
   Creation used to be the only chance to set a listing's text, so a listing
   kept describing whatever the extension did on day one while every later
   publish quietly refreshed the bundle underneath it. Owners (browser session
   or CI publisher token) can now keep the copy honest. */
store.patch('/extensions/:id', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const ext = await extensionById(c.req.param('id'));
  if (!ext) return c.json({ error: 'not found' }, 404);
  if (ext.owner_user_id !== user.id) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json().catch(() => ({}));
  const patch: Record<string, string | null> = {};
  for (const field of ['name', 'summary', 'description', 'homepageUrl', 'iconUrl'] as const) {
    if (!(field in body)) continue;
    const raw = body[field];
    if (raw === null) { patch[field] = null; continue; }
    if (typeof raw !== 'string') return c.json({ error: `${field} must be a string or null` }, 400);
    const trimmed = raw.trim();
    // A blank name would leave the listing untitled; every other field may clear.
    if (field === 'name' && !trimmed) return c.json({ error: 'name cannot be empty' }, 400);
    patch[field] = trimmed || null;
  }

  if (Object.keys(patch).length === 0) return c.json({ error: 'nothing to update' }, 400);

  const updated = await updateExtension(ext.id, patch);
  if (!updated) return c.json({ error: 'not found' }, 404);

  // Keep the public git trail in step with what the store now serves.
  const ver = await latestVersion(updated.id);
  if (ver && updated.status === 'live') await mirrorListing(updated, ver);

  return c.json({ ok: true, listing: await listingView(updated) });
});

/* ---------- publisher: key seal (seal v2) ----------
   The publisher's CRX signing keys are sealed under a passphrase only they
   know (apps/extensions/public/seal.js). The browser or script derives the
   data key (DEK) locally and sends it, never the passphrase, with the one
   request that needs a signing key: create one, migrate one, or sign a
   release. The key is opened inside that request and dropped; the packed .crx
   is stored, so downloads and updates never need the key. */

type DekResult = { ok: true; dek: Buffer; seal: PublisherSeal } | { ok: false; status: 400 | 403 | 409; error: string };

async function publisherDek(userId: string, dekB64: unknown): Promise<DekResult> {
  const seal = await publisherSeal(userId);
  if (!isPublisherSeal(seal)) {
    return { ok: false, status: 409, error: 'set a signing passphrase first (store: Signing passphrase)' };
  }
  if (typeof dekB64 !== 'string' || !dekB64) {
    return { ok: false, status: 400, error: 'signing passphrase required: send the derived key as "dek"' };
  }
  const dek = Buffer.from(dekB64, 'base64');
  if (!verifyDataKey(dek, seal, userId)) {
    dek.fill(0);
    return { ok: false, status: 403, error: 'wrong signing passphrase' };
  }
  return { ok: true, dek, seal };
}

/** Pack the version's artifact with the (already opened) key and store the .crx. */
async function packAndStore(ext: { id: string; slug: string }, ver: { id: string; version: string; crx_url?: string | null; bundle_url?: string | null }, pem: string, publicKeyDer: string): Promise<void> {
  const url = ver.crx_url || ver.bundle_url;
  if (!url) throw new Error('version has no artifact');
  const buf = await fetchArtifact(url);
  // Stamp our gupdate feed in before signing, or the install pins itself to
  // this version forever: Chromium polls the manifest's own update_url and
  // most publishers never set one. See stampUpdateUrl.
  const zip = stampUpdateUrl(artifactToZip(buf), `${APP_URL}/api/store/updates.xml?id=${ext.id}`);
  const crx = packCrx(zip, pem, Buffer.from(publicKeyDer, 'base64'));
  await saveSignedCrx({ versionId: ver.id, extensionId: ext.id, version: ver.version, crx });
}

/** Open the listing's key with the DEK and sign its latest version. */
async function signLatest(ext: { id: string; slug: string }, userId: string, dek: Buffer): Promise<{ signed: boolean; version?: string; error?: string }> {
  const key = await signingKeyFor(ext.id);
  if (!key) return { signed: false, error: 'no signing key' };
  const ver = await latestVersion(ext.id);
  if (!ver) return { signed: false, error: 'no version yet' };
  let pem: string | null = openPrivateKey(key.private_key_enc, dek, userId, ext.id);
  try {
    await packAndStore(ext, ver, pem, key.public_key_der);
    return { signed: true, version: ver.version };
  } finally {
    pem = null;
  }
}

store.get('/publisher/seal', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const seal = await publisherSeal(user.id);
  return c.json({ userId: user.id, seal: isPublisherSeal(seal) ? seal : null, legacyMigration: legacyMigrationEnabled() });
});

/* Set the passphrase (or reset it after losing it and the recovery key), then
   migrate this publisher's legacy keys in the same request and sign each
   listing's latest version. */
store.post('/publisher/seal', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({} as any));
  if (!isPublisherSeal(body.seal) || typeof body.dek !== 'string') return c.json({ error: 'invalid seal' }, 400);
  const dek = Buffer.from(body.dek, 'base64');
  try {
    if (!verifyDataKey(dek, body.seal, user.id)) return c.json({ error: 'seal does not match the key' }, 400);
    const existing = await publisherSeal(user.id);
    if (isPublisherSeal(existing) && body.reset !== true) {
      return c.json({ error: 'a signing passphrase is already set (reset loses every key sealed under it)' }, 409);
    }
    await savePublisherSeal(user.id, body.seal);

    let migrated = 0;
    let failed = 0;
    const signed: string[] = [];
    for (const ext of await extensionsOwnedBy(user.id)) {
      const key = await signingKeyFor(ext.id);
      if (!key) continue;
      if (!isSealedKey(key.private_key_enc)) {
        if (!legacyMigrationEnabled()) continue;
        try {
          let pem: string | null = legacyDecryptPrivateKey(key.private_key_enc);
          await replaceSigningKeyCiphertext(ext.id, sealPrivateKey(pem, dek, user.id, ext.id));
          pem = null;
          migrated++;
        } catch {
          failed++;
          continue;
        }
      }
      try {
        const r = await signLatest(ext, user.id, dek);
        if (r.signed) signed.push(ext.slug);
      } catch {
        // A key sealed under a previous (reset) passphrase stays unreadable.
      }
    }
    return c.json({ ok: true, migrated, failed, signed });
  } finally {
    dek.fill(0);
  }
});

/* ---------- publisher: signing key ----------
   Chromium only installs a signed .crx; a .zip is sideload-only. Generating the
   key here (rather than making publishers run openssl and guard a .pem) is what
   turns "Install" into a real install. The key is the extension's identity, so
   this is create-once — there is deliberately no rotate or delete. It is sealed
   under the publisher's passphrase before it is stored. */
store.post('/extensions/:id/signing-key', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const ext = await extensionById(c.req.param('id'));
  if (!ext) return c.json({ error: 'not found' }, 404);
  if (ext.owner_user_id !== user.id) return c.json({ error: 'forbidden' }, 403);

  const existing = await signingKeyFor(ext.id);
  if (existing) {
    return c.json({
      error: 'signing key already exists',
      message: 'The key sets the extension id permanently — rotating it would orphan every install.',
      crxId: existing.crx_id,
    }, 409);
  }

  const body = await c.req.json().catch(() => ({} as any));
  const auth = await publisherDek(user.id, body.dek);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);
  try {
    const key = generateSigningKey();
    await insertSigningKey({
      extensionId: ext.id,
      crxId: key.crxId,
      publicKeyDer: key.publicKeyDer,
      privateKeyEnc: sealPrivateKey(key.privateKeyPem, auth.dek, user.id, ext.id),
    });
    const ver = await latestVersion(ext.id);
    let signed = false;
    if (ver) {
      try {
        await packAndStore(ext, ver, key.privateKeyPem, key.publicKeyDer);
        signed = true;
      } catch { /* the publisher can sign again from the listing */ }
    }
    // The private key is never returned — the store signs on the publisher's
    // behalf while they are present. The PUBLIC half is not secret, and is
    // what pins the extension id: dropped into manifest.json's "key" field it
    // makes an unpacked install resolve to the same id as the store-packed .crx.
    return c.json({ ok: true, crxId: key.crxId, publicKey: key.publicKeyDer, signed });
  } catch (e: any) {
    return c.json({ error: e?.message || 'could not generate signing key' }, 500);
  } finally {
    auth.dek.fill(0);
  }
});

/* ---------- publisher: sign the latest version ----------
   For a release submitted without the passphrase (a script, a PR mirror),
   or a listing whose key was just migrated. */
store.post('/extensions/:id/sign', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const ext = await extensionById(c.req.param('id'));
  if (!ext) return c.json({ error: 'not found' }, 404);
  if (ext.owner_user_id !== user.id) return c.json({ error: 'forbidden' }, 403);
  const body = await c.req.json().catch(() => ({} as any));
  const auth = await publisherDek(user.id, body.dek);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);
  try {
    const r = await signLatest(ext, user.id, auth.dek);
    if (!r.signed) return c.json({ error: r.error }, 409);
    return c.json({ ok: true, version: r.version });
  } catch (e: any) {
    return c.json({ error: `could not sign: ${e?.message || e}` }, 422);
  } finally {
    auth.dek.fill(0);
  }
});

/* ---------- signed .crx download ----------
   Serves the .crx packed when the publisher last signed. The store holds no
   key that could pack one now. */
store.get('/extensions/:slug/download.crx', async (c) => {
  const ext = await extensionBySlug(c.req.param('slug'));
  if (!ext || ext.status !== 'live') return c.json({ error: 'not found' }, 404);
  const signed = await latestSignedCrx(ext.id);
  if (!signed) return c.json({ error: 'no signed release yet: the publisher signs one with their passphrase' }, 404);
  const crx = Buffer.from(signed.crx_b64, 'base64');
  c.header('content-type', 'application/x-chrome-extension');
  c.header('content-disposition', `attachment; filename="${ext.slug}-${signed.version}.crx"`);
  // Hono wants an ArrayBuffer, not a Node Buffer view over a pooled one.
  return c.body(crx.buffer.slice(crx.byteOffset, crx.byteOffset + crx.byteLength) as ArrayBuffer);
});

/* ---------- publisher: re-scan the current version ----------
   A scan verdict is written at publish time, so a listing published while the
   scanner was unavailable (or before zip bundles were scannable) keeps showing
   "unscanned" until its next release. This re-runs the scan against the
   artifact already on file — no re-upload, no version bump. */
store.post('/extensions/:id/rescan', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const ext = await extensionById(c.req.param('id'));
  if (!ext) return c.json({ error: 'not found' }, 404);
  if (ext.owner_user_id !== user.id) return c.json({ error: 'forbidden' }, 403);

  const ver = await latestVersion(ext.id);
  if (!ver) return c.json({ error: 'no published version to scan' }, 404);
  const target = ver.crx_url || ver.bundle_url;
  if (!target) return c.json({ error: 'version has no downloadable artifact' }, 400);

  try {
    const buf = await fetchArtifact(target);
    const result = scanArtifact(buf, ver.permissions_json ? JSON.parse(ver.permissions_json) : []);
    await persistScan(ext.id, ver.id, result);
    return c.json({ ok: true, scan: result });
  } catch (e: any) {
    return c.json({ error: `could not scan bundle: ${e?.message || e}` }, 422);
  }
});

/* ---------- publisher: create draft ---------- */
store.post('/extensions', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return c.json({ error: 'name required' }, 400);

  let slug = slugify(name);
  if (await slugTaken(slug)) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const ext = await createExtension({
    ownerUserId: user.id,
    slug,
    name,
    summary: body.summary ?? null,
    description: body.description ?? null,
    homepageUrl: body.homepageUrl ?? null,
    iconUrl: body.iconUrl ?? null,
  });
  return c.json({ ok: true, id: ext.id, slug: ext.slug });
});

/* ---------- AI auto-ingest: fill the whole listing from a .crx ----------
   Point us at a .crx URL and we read its manifest.json + icons + code:
   auto-fill name/summary/description/version/permissions/logo AND run the
   security scan. No forms. The publish gate is `scan.green`. */
store.post('/extensions/ingest', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const crxUrl = String(body.crxUrl || '').trim();
  if (!crxUrl) return c.json({ error: 'crxUrl required' }, 400);
  try {
    const buf = await fetchArtifact(crxUrl);
    const listing = extractListingFromCrx(buf);
    const scan = scanArtifact(buf, listing.permissions);
    return c.json({ ok: true, listing, scan });
  } catch (e: any) {
    return c.json({ error: e?.message || 'could not ingest .crx' }, 422);
  }
});

/* ---------- publisher SSH identity (files.profullstack.com) ----------
   Each publisher gets one AgentBBS member, provisioned from their SSH public
   key, so they can `scp` bundles to /public/extensions/<slug>/. */
function sanitizeHandle(raw: string): string {
  return String(raw || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
}

store.get('/publisher', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const pk = await publisherKey(user.id);
  if (!pk) return c.json({ publisher: null, scpTarget: SCP_TARGET });
  return c.json({
    publisher: { handle: pk.handle, fingerprint: pk.fingerprint, provisioned: !!pk.provisioned_at },
    scpTarget: SCP_TARGET,
  });
});

store.post('/publisher/key', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({}));

  const handle = sanitizeHandle(body.handle || (user.email ? user.email.split('@')[0] : '') || user.id.slice(0, 8));
  if (handle.length < 3) return c.json({ error: 'handle must be 3-20 chars of a-z, 0-9, dash' }, 400);
  if (await handleTaken(handle, user.id)) return c.json({ error: 'handle already taken' }, 409);

  // Either the dev brings their own public key, or we generate a keypair and
  // hand back the private key ONCE (never stored).
  let pubkey: string = (body.pubkey || '').trim();
  let privateKey: string | undefined;
  if (!pubkey && body.generate) {
    try {
      const kp = await generateKeypair(`${handle}@tronbrowser-store`);
      pubkey = kp.publicKey;
      privateKey = kp.privateKey;
    } catch (e: any) {
      return c.json({ error: `keygen unavailable: ${e.message}` }, 503);
    }
  }
  if (!pubkey) return c.json({ error: 'provide pubkey, or generate:true' }, 400);
  if (!/^(ssh-(ed25519|rsa)|ecdsa-)/.test(pubkey)) return c.json({ error: 'not an SSH public key' }, 400);

  // Provision the BBS member (full-auto SSH to the BBS host). If provisioning
  // isn't configured, still save the key so the operator can provision later.
  let fingerprint = '';
  let provisioned = false;
  try {
    const r = await provisionPublisher(handle, pubkey);
    fingerprint = r.fingerprint;
    provisioned = true;
  } catch (e: any) {
    if (e.message !== 'provisioning not configured') {
      return c.json({ error: `provisioning failed: ${e.message}` }, 502);
    }
  }
  await upsertPublisherKey({ userId: user.id, handle, pubkey, fingerprint, provisioned });

  return c.json({
    ok: true,
    handle,
    fingerprint: fingerprint || null,
    provisioned,
    scpTarget: SCP_TARGET,
    privateKey: privateKey ?? null, // shown ONCE; not stored
    note: provisioned
      ? 'Account ready — scp your bundle to /public/extensions/<slug>/'
      : 'Key saved; an operator will finish provisioning shortly.',
  });
});

/* ---------- publisher API tokens (headless / CI publishing) ----------
   A token authenticates CI as the publisher so it can push new versions without
   a browser session. Minting requires a real session (so a leaked CI token
   can't mint more). The raw token is returned ONCE; only its hash is stored. */
store.post('/publisher/tokens', async (c) => {
  const user = await sessionUser(c);
  if (!user) return c.json({ error: 'mint tokens from a signed-in browser session' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || 'ci').trim().slice(0, 40) || 'ci';
  const { token, id } = await createPublisherToken(user.id, name);
  return c.json({
    ok: true,
    token,
    id,
    name,
    note: 'Shown once — store it as the CI secret TRONBROWSER_STORE_TOKEN.',
  });
});

store.get('/publisher/tokens', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ tokens: await listPublisherTokens(user.id) });
});

store.delete('/publisher/tokens/:id', async (c) => {
  const user = await sessionUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const ok = await revokePublisherToken(user.id, c.req.param('id'));
  return c.json({ ok }, ok ? 200 : 404);
});

/* ---------- publisher: submit an MV3 version (upload or PR) ----------
   Accepts JSON: { manifest, bundleUrl?, crxUrl?, bundleSha256?, sizeBytes?, source? }
   `manifest` may be the manifest.json string or object. We keep Chromium's
   format intact and only validate it's well-formed MV3. */
store.post('/extensions/:id/versions', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const ext = await extensionById(c.req.param('id'));
  if (!ext) return c.json({ error: 'not found' }, 404);
  if (ext.owner_user_id !== user.id) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json().catch(() => ({}));
  const v = validateManifest(body.manifest);
  if (!v.ok || !v.manifest) return c.json({ error: 'invalid MV3 manifest', errors: v.errors }, 422);

  // Where does Chromium fetch the code from? Two ways:
  //  (a) the publisher scp'd to files.profullstack.com and tells us the
  //      filenames -> we derive the public URL from the slug convention and
  //      HEAD-check it's actually up; or
  //  (b) they host it elsewhere and pass bundleUrl/crxUrl directly.
  let crxUrl: string | null = body.crxUrl ?? null;
  let bundleUrl: string | null = body.bundleUrl ?? null;

  const files = body.files || {};
  if (files.crx || files.zip) {
    if (files.crx) {
      const url = publicUrlFor(ext.slug, String(files.crx));
      if (!(await artifactExists(url))) {
        return c.json({ error: `not found at ${url} — scp it first: ${scpCommand(ext.slug, String(files.crx))}` }, 400);
      }
      crxUrl = url;
    }
    if (files.zip) {
      const url = publicUrlFor(ext.slug, String(files.zip));
      if (!(await artifactExists(url))) {
        return c.json({ error: `not found at ${url} — scp it first: ${scpCommand(ext.slug, String(files.zip))}` }, 400);
      }
      bundleUrl = url;
    }
  }

  if (!bundleUrl && !crxUrl) {
    return c.json({
      error: 'no artifact — scp your .crx/.zip to files.profullstack.com and pass files:{crx,zip}, or pass bundleUrl/crxUrl',
      scp: scpCommand(ext.slug),
    }, 400);
  }

  // ── Security scan GATE ──────────────────────────────────────────────
  // If we can fetch a .crx, scan its code + permissions and BLOCK the submit
  // on any critical finding (green light required to publish). Zip-only
  // bundles fall back to the async (non-gating) vu1nz scan.
  // A .crx is just a header around a ZIP, so scan whichever artifact exists.
  // Gating only on .crx meant every zip-only listing skipped the scanner and
  // fell through to the async path — which records 'skipped' when no external
  // scanner is configured, leaving the listing permanently "unscanned".
  const scanTarget = crxUrl || bundleUrl;
  let scanResult: ExtensionScanResult | null = null;
  if (scanTarget) {
    try {
      const buf = await fetchArtifact(scanTarget);
      scanResult = scanArtifact(buf, v.permissions);
    } catch (e: any) {
      return c.json({ error: `could not scan bundle: ${e?.message || e}` }, 422);
    }
    if (!scanResult.green) {
      return c.json({
        error: 'scan_failed',
        message: 'Security scan found blocking (critical) issues. Fix them and resubmit.',
        scan: scanResult,
      }, 422);
    }
  }

  const version = await addVersion({
    extensionId: ext.id,
    version: v.manifest.version,
    manifestVersion: v.manifest.manifest_version,
    manifestJson: typeof body.manifest === 'string' ? body.manifest : JSON.stringify(body.manifest),
    permissions: v.permissions,
    bundleUrl,
    crxUrl,
    bundleSha256: body.bundleSha256 ?? null,
    sizeBytes: body.sizeBytes ?? null,
    source: body.source === 'pr' ? 'pr' : 'upload',
  });

  if (scanResult) {
    // Persist the gating scan result for the store badge.
    await persistScan(ext.id, version.id, scanResult);
  } else {
    // No fetchable artifact at all — fall back to the async vu1nz scan, which
    // records 'skipped' when no external scanner is configured.
    await enqueueScan(ext.id, version);
  }

  // Sign now when the publisher sent their signing key (derived from the
  // passphrase); otherwise the release waits for POST /extensions/:id/sign and
  // installs keep getting the last signed one.
  let signed: { signed: boolean; error?: string } = { signed: false };
  if (await signingKeyFor(ext.id)) {
    const auth = body.dek ? await publisherDek(user.id, body.dek) : null;
    if (auth?.ok) {
      try {
        signed = await signLatest(ext, user.id, auth.dek);
      } catch (e: any) {
        signed = { signed: false, error: e?.message || String(e) };
      } finally {
        auth.dek.fill(0);
      }
    } else {
      signed = { signed: false, error: auth ? auth.error : 'not signed: send "dek" or sign it from the listing' };
    }
  }

  return c.json({ ok: true, versionId: version.id, version: version.version, warnings: v.warnings, scan: scanResult, signed });
});

/* ---------- pay the $1 listing fee ---------- */
store.post('/extensions/:id/checkout', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const ext = await extensionById(c.req.param('id'));
  if (!ext) return c.json({ error: 'not found' }, 404);
  if (ext.owner_user_id !== user.id) return c.json({ error: 'forbidden' }, 403);
  if (!(await latestVersion(ext.id))) return c.json({ error: 'submit a version before paying' }, 400);
  if (await hasPaidListing(ext.id)) return c.json({ error: 'already paid', alreadyLive: true }, 409);

  // A `method` field is tolerated and ignored: there is one rail (CoinPay's hosted
  // checkout, where the buyer picks any coin or PayPal), so it is ignored.
  await c.req.json().catch(() => ({}));

  const paymentId = await createPayment({ extensionId: ext.id, userId: user.id, method: 'coinpay' });
  try {
    const slug = encodeURIComponent(ext.slug);
    const session = await createListingCheckout({
      extensionId: ext.id,
      paymentId,
      slug: ext.slug,
      userId: user.id,
      // CoinPay requires an email; wallet-only accounts get a stable per-user address.
      email: user.email || `${user.id}@users.tronbrowser.dev`,
      successUrl: `${APP_URL}/store/extension.html?slug=${slug}&paid=1`,
      cancelUrl: `${APP_URL}/store/extension.html?slug=${slug}&canceled=1`,
    });
    await setPaymentRef(paymentId, session.id);
    return c.json({ method: 'coinpay', paymentId, sessionId: session.id, checkoutUrl: session.url });
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});

/* ---------- reconcile a checkout session (optional; the webhook is primary) ---------- */
store.post('/extensions/:id/confirm', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const ext = await extensionById(c.req.param('id'));
  if (!ext) return c.json({ error: 'not found' }, 404);
  if (ext.owner_user_id !== user.id) return c.json({ error: 'forbidden' }, 403);
  if (await hasPaidListing(ext.id)) return c.json({ ok: true, live: true });

  const { sessionId, reference } = await c.req.json().catch(() => ({}));
  const ref = sessionId || reference;
  if (!ref) return c.json({ error: 'sessionId required' }, 400);
  if (!(await listingSessionPaid(ref))) return c.json({ error: 'payment not received yet' }, 402);

  // Only a session we created for this extension can settle it.
  const extId = await markPaidByRef(ref);
  if (extId && extId !== ext.id) return c.json({ error: 'session belongs to another listing' }, 409);
  if (extId) await publish(extId);
  return c.json({ ok: true, live: await hasPaidListing(ext.id) });
});

/* ---------- CoinPay webhook (signature over the raw body) ---------- */
store.post('/payments/coinpay/webhook', async (c) => {
  const raw = await c.req.text();
  const ev = readListingWebhook(raw, c.req.header('x-coinpay-signature'));
  if (!ev) return c.json({ error: 'invalid signature' }, 401);

  if (ev.paid && ev.sessionId) {
    // confirmed and forwarded can both arrive for one session: markPaid* only
    // flips a pending row, so the second event is a no-op.
    let extId = await markPaidByRef(ev.sessionId);
    if (!extId && ev.localPaymentId) extId = await markPaidById(ev.localPaymentId, ev.sessionId);
    if (extId) await publish(extId);
  }
  return c.json({ received: true });
});

/* ---------- community flagging ---------- */
store.post('/extensions/:slug/flag', async (c) => {
  const ext = await extensionBySlug(c.req.param('slug'));
  if (!ext) return c.json({ error: 'not found' }, 404);
  const user = await currentUser(c);
  const { reason, detail } = await c.req.json().catch(() => ({}));
  const allowed = ['malware', 'privacy', 'broken', 'spam', 'other'];
  if (!allowed.includes(reason)) return c.json({ error: `reason must be one of ${allowed.join(', ')}` }, 400);
  await addFlag({ extensionId: ext.id, reporterUserId: user?.id ?? null, reason, detail: detail ?? null });
  return c.json({ ok: true });
});

/* ---------- Chromium gupdate update-manifest XML ----------
   Extensions set "update_url": "https://tronbrowser.dev/api/store/updates.xml?id=<id>"
   in their manifest; Chromium polls this to install + auto-update. We keep the
   exact omaha/gupdate format Chromium expects. */
store.get('/updates.xml', async (c) => {
  const id = c.req.query('id') || '';
  const ext = id ? await extensionById(id) : null;
  const ver = ext && ext.status === 'live' ? await latestVersion(ext.id) : null;
  const key = ext ? await signingKeyFor(ext.id) : null;
  const signed = key && ext ? await latestSignedCrx(ext.id) : null;

  // Chromium can only install a signed .crx, so only ever advertise one: the
  // release the publisher last signed (its version, not an unsigned newer one).
  const codebase = signed
    ? `${APP_URL}/api/store/extensions/${ext!.slug}/download.crx`
    : key ? null : ver?.crx_url || null;
  const advertised = signed ? signed.version : ver?.version;

  c.header('content-type', 'application/xml; charset=utf-8');
  if (!ext || !ver || !codebase) {
    return c.body(`<?xml version='1.0' encoding='UTF-8'?>\n<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'></gupdate>\n`);
  }
  return c.body(
    `<?xml version='1.0' encoding='UTF-8'?>\n` +
    `<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>\n` +
    // appid must be the Chromium extension id (derived from the signing key),
    // not our internal uuid — the browser matches updates on the former.
    `  <app appid='${xmlEscape(key?.crx_id || ext.id)}'>\n` +
    `    <updatecheck codebase='${xmlEscape(codebase)}' version='${xmlEscape(advertised ?? ver.version)}' />\n` +
    `  </app>\n` +
    `</gupdate>\n`,
  );
});

/* ---------- download redirect ---------- */
store.get('/extensions/:slug/download', async (c) => {
  const ext = await extensionBySlug(c.req.param('slug'));
  if (!ext || ext.status !== 'live') return c.json({ error: 'not found' }, 404);
  const ver = await latestVersion(ext.id);
  const url = ver?.crx_url || ver?.bundle_url;
  if (!url) return c.json({ error: 'no artifact' }, 404);
  // Hand over an installable .crx when the listing has a key; the raw .zip is
  // a sideload artifact the browser can only save to disk.
  if (await latestSignedCrx(ext.id)) {
    return c.redirect(`${APP_URL}/api/store/extensions/${ext.slug}/download.crx`);
  }
  return c.redirect(url);
});

/** Promote an extension to live + mirror to git. Idempotent-ish. */
async function publish(extensionId: string): Promise<void> {
  const ext = await extensionById(extensionId);
  if (!ext) return;
  if (ext.status !== 'live') await setExtensionStatus(extensionId, 'live');
  const ver = await latestVersion(extensionId);
  if (ver) await mirrorListing({ ...ext, status: 'live' }, ver);
}
