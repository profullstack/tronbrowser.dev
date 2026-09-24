#!/usr/bin/env node
/**
 * Publish one extension version to the TronBrowser store.
 *
 * Every extension we own was published by hand, which meant in practice that
 * none of them were: the store had one listing and our own MarkSyncr was not in
 * it. A release that does not reach the store is a release TronBrowser cannot
 * auto-update to, so this runs from CI on every tag.
 *
 * Usage:
 *   node scripts/store-publish.mjs \
 *     --name "MarkSyncr" \
 *     --manifest path/to/manifest.json \
 *     --bundle-url https://github.com/.../marksyncr-chrome.zip
 *
 * Optional:
 *   --slug <slug>        look the listing up by slug instead of by name
 *   --crx-url <url>      a signed .crx, if the project builds one
 *   --store <base url>   defaults to https://tronbrowser.dev
 *   --dry-run            resolve and validate, write nothing
 *
 * Auth: TRONBROWSER_STORE_TOKEN, a `tbpub_` publisher token. Minted once from a
 * signed-in browser session at tronbrowser.dev — the API refuses to mint one
 * from a token, deliberately, so a leaked CI token cannot mint more.
 */

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const has = (name) => args.includes(`--${name}`);

const STORE = (arg('store') || process.env.TRONBROWSER_STORE || 'https://tronbrowser.dev').replace(/\/$/, '');
const TOKEN = process.env.TRONBROWSER_STORE_TOKEN || '';
const DRY = has('dry-run');

const name = arg('name');
const slugArg = arg('slug');
const manifestPath = arg('manifest');
const bundleUrl = arg('bundle-url');
const crxUrl = arg('crx-url');

function die(message) {
  console.error(`store-publish: ${message}`);
  process.exit(1);
}

if (!name && !slugArg) die('--name or --slug is required');
if (!manifestPath) die('--manifest is required');
if (!bundleUrl && !crxUrl) die('--bundle-url or --crx-url is required');
if (!TOKEN && !DRY) die('TRONBROWSER_STORE_TOKEN is not set');

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (err) {
  die(`could not read ${manifestPath}: ${err.message}`);
}
if (Number(manifest.manifest_version) !== 3) {
  die(`${manifestPath} is manifest_version ${manifest.manifest_version}; the store takes MV3 only`);
}

const headers = {
  authorization: `Bearer ${TOKEN}`,
  'content-type': 'application/json',
};

async function api(path, init = {}) {
  const res = await fetch(`${STORE}/api/store${path}`, { ...init, headers });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

/** The listing for this extension, creating it the first time. */
async function resolveListing() {
  const slug = slugArg || slugify(name);
  const found = await api(`/extensions/${encodeURIComponent(slug)}`);
  // GET /extensions/:slug returns the listing itself, not {extension: ...}.
  const existing = found.body?.extension ?? found.body;
  if (found.ok && existing?.id) {
    console.log(`  listing ${existing.slug} (${existing.id})`);
    return existing;
  }
  if (found.status !== 404) {
    die(`looking up ${slug} failed with ${found.status}: ${JSON.stringify(found.body).slice(0, 300)}`);
  }

  if (DRY) {
    console.log(`  [dry-run] would create the listing "${name}"`);
    return { id: '(dry-run)', slug };
  }
  const created = await api('/extensions', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  if (!created.ok) {
    die(`creating the listing failed with ${created.status}: ${JSON.stringify(created.body)}`);
  }
  const ext = created.body.extension || created.body;
  console.log(`  created listing ${ext.slug} (${ext.id})`);
  return ext;
}

/** Mirrors the server's slugify closely enough to find an existing listing. */
function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const listing = await resolveListing();

const payload = {
  manifest,
  ...(bundleUrl ? { bundleUrl } : {}),
  ...(crxUrl ? { crxUrl } : {}),
};

if (DRY) {
  console.log(`  [dry-run] would publish ${manifest.name} ${manifest.version}`);
  console.log(`  [dry-run] artifact: ${crxUrl || bundleUrl}`);
  process.exit(0);
}

const published = await api(`/extensions/${listing.id}/versions`, {
  method: 'POST',
  body: JSON.stringify(payload),
});

if (!published.ok) {
  // A version that is already published is not a failure: a re-run of the same
  // tag should be safe, and the alternative is a red release for work that is
  // already done.
  const message = JSON.stringify(published.body);
  if (published.status === 409 || /already/i.test(message)) {
    console.log(`  ${manifest.version} is already published, nothing to do`);
    process.exit(0);
  }
  die(`publishing ${manifest.version} failed with ${published.status}: ${message}`);
}

console.log(`  published ${manifest.name} ${manifest.version} to ${STORE}/store/`);
if (published.body?.scan) {
  console.log(`  scan: ${JSON.stringify(published.body.scan)}`);
}
