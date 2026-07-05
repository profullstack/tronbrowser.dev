// Extension store routes, mounted at /api/store by services/api/src/index.ts.
//
// Flow: create draft -> submit MV3 version (upload or PR) -> pay $1 (Stripe or
// CoinPay/x402) -> listing goes LIVE instantly + git mirror + async vu1nz scan.
// Chromium install/auto-update keeps working via /api/store/updates.xml.
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { userBySession, type User } from '../db.js';
import {
  createExtension, extensionById, extensionBySlug, slugTaken, listLiveExtensions,
  setExtensionStatus, addVersion, latestVersion, createPayment, setPaymentRef,
  markPaidByRef, hasPaidListing, latestScan, addFlag, openFlagCount,
  publisherKey, handleTaken, upsertPublisherKey,
  createPublisherToken, userByPublisherToken, listPublisherTokens, revokePublisherToken,
} from './db.js';
import { validateManifest, slugify } from './manifest.js';
import {
  provisionPublisher, generateKeypair, publicUrlFor, scpCommand, artifactExists, SCP_TARGET,
} from './fileshost.js';
import {
  createStripeCheckout, verifyStripeWebhook, listingPaymentRequirements,
  confirmCoinPaySettlement, LISTING_FEE_CENTS,
} from './payments.js';
import { enqueueScan } from './vu1nz.js';
import { mirrorListing } from './mirror.js';
import { fetchCrx, extractListingFromCrx } from './crx.js';
import { scanCrx } from './scanner.js';
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
async function listingView(ext: any) {
  const [ver, scan, flags] = await Promise.all([
    latestVersion(ext.id),
    latestScan(ext.id),
    openFlagCount(ext.id),
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
    updateUrl: `${APP_URL}/api/store/updates.xml?id=${ext.id}`,
  };
}

export const store = new Hono();

store.get('/healthz', (c) => c.json({ ok: true, service: 'store' }));

/* ---------- browse ---------- */
store.get('/extensions', async (c) => {
  const q = c.req.query('q') || undefined;
  const limit = Number(c.req.query('limit') || 50);
  const offset = Number(c.req.query('offset') || 0);
  const rows = await listLiveExtensions({ q, limit, offset });
  return c.json({ extensions: await Promise.all(rows.map(listingView)) });
});

store.get('/extensions/:slug', async (c) => {
  const ext = await extensionBySlug(c.req.param('slug'));
  if (!ext || ext.status === 'removed') return c.json({ error: 'not found' }, 404);
  return c.json(await listingView(ext));
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
    const buf = await fetchCrx(crxUrl);
    const listing = extractListingFromCrx(buf);
    const scan = scanCrx(buf, listing.permissions);
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
  let scanResult: Awaited<ReturnType<typeof scanCrx>> | null = null;
  if (crxUrl) {
    try {
      const buf = await fetchCrx(crxUrl);
      scanResult = scanCrx(buf, v.permissions);
    } catch (e: any) {
      return c.json({ error: `could not scan .crx: ${e?.message || e}` }, 422);
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
    const scanId = await createScan(ext.id, version.id);
    await updateScan(scanId, {
      status: 'done',
      score: scanResult.green ? 100 : 40,
      severity: scanResult.status === 'malicious' ? 'critical' : scanResult.status === 'suspicious' ? 'high' : 'clean',
      findingsJson: JSON.stringify(scanResult.findings),
    });
  } else {
    // Zip-only: fall back to the async (non-gating) vu1nz scan.
    await enqueueScan(ext.id, version);
  }

  return c.json({ ok: true, versionId: version.id, version: version.version, warnings: v.warnings, scan: scanResult });
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

  const method = (await c.req.json().catch(() => ({}))).method || 'stripe';

  if (method === 'stripe') {
    const paymentId = await createPayment({ extensionId: ext.id, userId: user.id, method: 'stripe' });
    try {
      const session = await createStripeCheckout({
        extensionId: ext.id,
        paymentId,
        successUrl: `${APP_URL}/store/extension.html?slug=${ext.slug}&paid=1`,
        cancelUrl: `${APP_URL}/store/submit.html?ext=${ext.id}&canceled=1`,
      });
      await setPaymentRef(paymentId, session.id);
      return c.json({ method: 'stripe', checkoutUrl: session.url });
    } catch (e: any) {
      return c.json({ error: e.message }, 502);
    }
  }

  if (method === 'coinpay' || method === 'x402') {
    const resource = `${APP_URL}/api/store/extensions/${ext.id}/checkout`;
    const reqs = listingPaymentRequirements(resource);
    // Record a pending payment the client confirms via /confirm.
    const paymentId = await createPayment({ extensionId: ext.id, userId: user.id, method: 'x402' });
    return c.json({ method: 'x402', paymentId, amountCents: LISTING_FEE_CENTS, ...reqs }, 402);
  }

  return c.json({ error: 'unknown payment method' }, 400);
});

/* ---------- CoinPay/x402 settlement confirm ---------- */
store.post('/extensions/:id/confirm', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const ext = await extensionById(c.req.param('id'));
  if (!ext) return c.json({ error: 'not found' }, 404);
  if (ext.owner_user_id !== user.id) return c.json({ error: 'forbidden' }, 403);

  const { paymentId, reference } = await c.req.json().catch(() => ({}));
  if (!paymentId || !reference) return c.json({ error: 'paymentId and reference required' }, 400);
  if (!(await confirmCoinPaySettlement(reference))) return c.json({ error: 'settlement not verified' }, 402);

  await setPaymentRef(paymentId, reference);
  const extId = await markPaidByRef(reference);
  if (extId) await publish(extId);
  return c.json({ ok: true, live: true });
});

/* ---------- Stripe webhook (raw body) ---------- */
store.post('/payments/stripe/webhook', async (c) => {
  const raw = await c.req.text();
  const event = verifyStripeWebhook(raw, c.req.header('stripe-signature'));
  if (!event) return c.json({ error: 'invalid signature' }, 400);

  if (event.type === 'checkout.session.completed') {
    const sessionId = event.data?.object?.id;
    if (sessionId) {
      const extId = await markPaidByRef(sessionId);
      if (extId) await publish(extId);
    }
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
  const codebase = ver?.crx_url || ver?.bundle_url;

  c.header('content-type', 'application/xml; charset=utf-8');
  if (!ext || !ver || !codebase) {
    return c.body(`<?xml version='1.0' encoding='UTF-8'?>\n<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'></gupdate>\n`);
  }
  return c.body(
    `<?xml version='1.0' encoding='UTF-8'?>\n` +
    `<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>\n` +
    `  <app appid='${xmlEscape(ext.id)}'>\n` +
    `    <updatecheck codebase='${xmlEscape(codebase)}' version='${xmlEscape(ver.version)}' />\n` +
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
