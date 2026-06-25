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
} from './db.js';
import { validateManifest, slugify } from './manifest.js';
import {
  createStripeCheckout, verifyStripeWebhook, listingPaymentRequirements,
  confirmCoinPaySettlement, LISTING_FEE_CENTS,
} from './payments.js';
import { enqueueScan } from './vu1nz.js';
import { mirrorListing } from './mirror.js';

const APP_URL = process.env.APP_URL || 'https://tronbrowser.dev';

async function currentUser(c: any): Promise<User | null> {
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const sess = bearer || getCookie(c, 'tb_session');
  return sess ? userBySession(sess) : null;
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

  // Need somewhere for Chromium to fetch the code from (hosted by the dev, or a
  // bucket upload — see /upload). At least one artifact URL is required.
  if (!body.bundleUrl && !body.crxUrl) {
    return c.json({ error: 'bundleUrl or crxUrl required (host the .zip/.crx, or use the upload endpoint)' }, 400);
  }

  const version = await addVersion({
    extensionId: ext.id,
    version: v.manifest.version,
    manifestVersion: v.manifest.manifest_version,
    manifestJson: typeof body.manifest === 'string' ? body.manifest : JSON.stringify(body.manifest),
    permissions: v.permissions,
    bundleUrl: body.bundleUrl ?? null,
    crxUrl: body.crxUrl ?? null,
    bundleSha256: body.bundleSha256 ?? null,
    sizeBytes: body.sizeBytes ?? null,
    source: body.source === 'pr' ? 'pr' : 'upload',
  });

  // Fire-and-forget async vu1nz scan (non-gating).
  await enqueueScan(ext.id, version);

  return c.json({ ok: true, versionId: version.id, version: version.version, warnings: v.warnings });
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
