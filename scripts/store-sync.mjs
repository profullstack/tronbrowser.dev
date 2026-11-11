#!/usr/bin/env node
/**
 * Keep the TronBrowser store in step with our own extensions' GitHub releases.
 *
 * One central job instead of a publish step in every extension repo: the store
 * had one listing for months because publishing was a manual act each repo had
 * to remember. apps/extensions/house.json lists every extension we own; this
 * reads each one's newest matching release, and when it is newer than what the
 * store serves, publishes it (creating the listing the first time). Runs on a
 * schedule from .github/workflows/store-sync.yml, so a release lands in the
 * store without anyone touching it.
 *
 * Usage:
 *   node scripts/store-sync.mjs [--only <slug>] [--dry-run] [--registry path]
 *
 * Env:
 *   TRONBROWSER_STORE_TOKEN  tbpub_ publisher token (house account). Required unless --dry-run.
 *   TRON_SIGNING_PASSPHRASE  the publisher's signing passphrase. Without it versions
 *                            are listed but installs keep the last signed .crx.
 *   GITHUB_TOKEN             optional, raises the GitHub API rate limit.
 *   TRONBROWSER_STORE        store base URL, default https://tronbrowser.dev
 *
 * The house account must be in the server's STORE_HOUSE_PUBLISHERS, or new
 * listings stop at draft waiting for the $1 fee.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DRY = args.includes('--dry-run');
const ONLY = arg('only');
const REGISTRY = arg('registry', join(HERE, '..', 'apps/extensions/house.json'));
const STORE = (process.env.TRONBROWSER_STORE || 'https://tronbrowser.dev').replace(/\/$/, '');
const TOKEN = process.env.TRONBROWSER_STORE_TOKEN || '';
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const PASSPHRASE = process.env.TRON_SIGNING_PASSPHRASE || '';

if (!TOKEN && !DRY) {
  console.error('store-sync: TRONBROWSER_STORE_TOKEN is not set');
  process.exit(1);
}

/* ---------- semver-ish compare (x.y.z[.w], numeric parts only) ---------- */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/* ---------- HTTP ---------- */
async function store(path, init = {}) {
  const res = await fetch(`${STORE}/api/store${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { ok: res.ok, status: res.status, body };
}

async function github(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'tronbrowser-store-sync',
      ...(GH_TOKEN ? { authorization: `Bearer ${GH_TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} -> ${res.status}`);
  return res.json();
}

/** Newest non-draft, non-prerelease release whose tag and asset both match. */
async function latestRelease(entry) {
  const tagRe = new RegExp(entry.tag);
  const assetRe = new RegExp(entry.asset);
  const releases = await github(`/repos/${entry.repo}/releases?per_page=100`);
  const hits = releases
    .filter((r) => !r.draft && !r.prerelease && tagRe.test(r.tag_name))
    .map((r) => ({ release: r, asset: (r.assets || []).find((a) => assetRe.test(a.name)) }))
    .filter((x) => x.asset)
    .sort((x, y) => Date.parse(y.release.published_at) - Date.parse(x.release.published_at));
  return hits[0] || null;
}

/* ---------- bundle inspection ---------- */
function readBundle(url) {
  const dir = mkdtempSync(join(tmpdir(), 'store-sync-'));
  const zip = join(dir, 'bundle.zip');
  try {
    execFileSync('curl', ['-fsSL', '-o', zip, url]);
    const manifest = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json']).toString('utf8'));
    let iconUrl = null;
    const icons = manifest.icons || {};
    const best = Object.keys(icons).sort((a, b) => Number(b) - Number(a))[0];
    if (best && /\.png$/i.test(icons[best])) {
      try {
        const png = execFileSync('unzip', ['-p', zip, icons[best].replace(/^\//, '')]);
        if (png.length > 0 && png.length < 64 * 1024) iconUrl = `data:image/png;base64,${png.toString('base64')}`;
      } catch { /* no icon is not fatal */ }
    }
    return { manifest, iconUrl };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const isMsg = (s) => typeof s === 'string' && s.startsWith('__MSG_');

/* ---------- signing ---------- */
let dek = null;
async function signingKey() {
  if (!PASSPHRASE || DRY) return null;
  if (dek) return dek;
  await import('../apps/extensions/public/seal.js');
  const sealed = await store('/publisher/seal');
  if (!sealed.ok || !sealed.body?.seal) throw new Error('TRON_SIGNING_PASSPHRASE is set but the publisher has no seal');
  dek = await globalThis.TronSeal.unlock(sealed.body.seal, PASSPHRASE, sealed.body.userId);
  return dek;
}

/* ---------- one extension ---------- */
async function sync(entry) {
  const hit = await latestRelease(entry);
  if (!hit) {
    console.log(`- ${entry.slug}: no release of ${entry.repo} matches ${entry.tag} with an asset matching ${entry.asset}`);
    return 'skipped';
  }
  const bundleUrl = hit.asset.browser_download_url;
  const { manifest, iconUrl } = readBundle(bundleUrl);
  if (Number(manifest.manifest_version) !== 3) throw new Error(`${bundleUrl} is not Manifest V3`);
  const version = manifest.version;

  const found = await store(`/extensions/${encodeURIComponent(entry.slug)}`);
  let listing = found.ok ? found.body : null;
  if (!found.ok && found.status !== 404) throw new Error(`lookup failed: ${found.status} ${JSON.stringify(found.body).slice(0, 200)}`);

  const current = listing?.version?.version || null;
  const summary = entry.summary || (isMsg(manifest.description) ? null : String(manifest.description || '').slice(0, 200)) || null;

  // A draft (published before the house exemption reached the server, say)
  // republishes its version so it goes live, instead of counting as current.
  const draft = listing?.status === 'draft';
  if (current && !draft && compareVersions(version, current) <= 0) {
    console.log(`= ${entry.slug}: store has ${current}, latest release ${hit.release.tag_name} is ${version}`);
    if (listing && !listing.iconUrl && iconUrl && !DRY) await store(`/extensions/${listing.id}`, { method: 'PATCH', body: JSON.stringify({ iconUrl }) });
    return 'current';
  }
  if (DRY) {
    console.log(`~ ${entry.slug}: would publish ${version} from ${bundleUrl}${listing ? '' : ' (new listing)'}`);
    return 'dry-run';
  }

  if (!listing) {
    // Create with the slug as the name so the server's slugify lands on the slug
    // we asked for, then set the real copy.
    const created = await store('/extensions', { method: 'POST', body: JSON.stringify({ name: entry.slug }) });
    if (!created.ok) throw new Error(`create failed: ${created.status} ${JSON.stringify(created.body)}`);
    if (created.body.slug !== entry.slug) throw new Error(`slug ${entry.slug} is taken (got ${created.body.slug})`);
    const description = entry.description
      || [isMsg(manifest.description) ? '' : manifest.description, `Source: https://github.com/${entry.repo}`].filter(Boolean).join('\n\n');
    const patched = await store(`/extensions/${created.body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: entry.name, summary, description, homepageUrl: entry.homepageUrl || null, iconUrl }),
    });
    if (!patched.ok) throw new Error(`listing copy failed: ${patched.status} ${JSON.stringify(patched.body)}`);
    listing = { id: created.body.id, slug: created.body.slug, crxId: null };
    console.log(`+ ${entry.slug}: created listing ${listing.id}`);
  } else if (!listing.iconUrl && iconUrl) {
    await store(`/extensions/${listing.id}`, { method: 'PATCH', body: JSON.stringify({ iconUrl }) });
  }

  const key = await signingKey();
  const published = await store(`/extensions/${listing.id}/versions`, {
    method: 'POST',
    body: JSON.stringify({ manifest, bundleUrl, sizeBytes: hit.asset.size, ...(key && listing.crxId ? { dek: key } : {}) }),
  });
  if (!published.ok) {
    const msg = JSON.stringify(published.body);
    if (published.status === 409 || /already/i.test(msg)) {
      console.log(`= ${entry.slug}: ${version} already published`);
      return 'current';
    }
    throw new Error(`publish ${version} failed: ${published.status} ${msg.slice(0, 500)}`);
  }
  console.log(`^ ${entry.slug}: published ${version} (${hit.release.tag_name})${published.body.live ? ', live' : ''}`);
  if (published.body.live === false) console.log(`  ! ${entry.slug} is still a draft: is the house account in STORE_HOUSE_PUBLISHERS?`);

  if (key && !listing.crxId) {
    // First signed release: the key is the extension's permanent id, created once.
    const signed = await store(`/extensions/${listing.id}/signing-key`, { method: 'POST', body: JSON.stringify({ dek: key }) });
    if (signed.ok) console.log(`  signed: new id ${signed.body.crxId}${signed.body.signed ? '' : ' (pack failed, will retry next run)'}`);
    else console.log(`  ! signing key: ${signed.status} ${JSON.stringify(signed.body)}`);
  } else if (key && published.body.signed && !published.body.signed.signed) {
    console.log(`  ! not signed: ${published.body.signed.error}`);
  } else if (!key) {
    console.log('  (unsigned: TRON_SIGNING_PASSPHRASE not set)');
  }
  return 'published';
}

/* ---------- main ---------- */
const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const entries = registry.extensions.filter((e) => !ONLY || e.slug === ONLY);
const results = {};
let failed = 0;
for (const entry of entries) {
  try {
    results[entry.slug] = await sync(entry);
  } catch (e) {
    failed++;
    results[entry.slug] = 'failed';
    console.log(`! ${entry.slug}: ${e.message}`);
  }
}
const summaryLine = Object.entries(results).map(([k, v]) => `${k}=${v}`).join(' ');
console.log(`\nstore-sync: ${summaryLine}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### Store sync\n\n${Object.entries(results).map(([k, v]) => `- \`${k}\`: ${v}`).join('\n')}\n`, { flag: 'a' });
}
process.exit(failed ? 1 : 0);
