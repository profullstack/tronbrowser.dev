// Git registry mirror. The DB is the source of truth (instant publish), but
// every published listing is also committed to a public registry repo for an
// auditable, forkable trail — `apps/extensions/registry/<slug>/listing.json`.
//
// Uses the GitHub contents API directly (no octokit dep). Behind env:
//   STORE_REGISTRY_REPO   e.g. "profullstack/tronbrowser-extensions"
//   GITHUB_TOKEN          repo-scoped token
// No-op (logs) when unset, so publish works without the mirror wired.
import type { Extension, ExtensionVersion } from './db.js';

export interface ListingRecord {
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  homepage_url: string | null;
  version: string;
  manifest_version: number;
  permissions: string[];
  bundle_url: string | null;
  crx_url: string | null;
  bundle_sha256: string | null;
  published_at: string;
}

export function buildListingRecord(ext: Extension, version: ExtensionVersion): ListingRecord {
  return {
    slug: ext.slug,
    name: ext.name,
    summary: ext.summary,
    description: ext.description,
    homepage_url: ext.homepage_url,
    version: version.version,
    manifest_version: version.manifest_version,
    permissions: version.permissions_json ? JSON.parse(version.permissions_json) : [],
    bundle_url: version.bundle_url,
    crx_url: version.crx_url,
    bundle_sha256: version.bundle_sha256,
    published_at: new Date().toISOString(),
  };
}

/** Commit/update the listing.json in the registry repo. Never throws. */
export async function mirrorListing(ext: Extension, version: ExtensionVersion): Promise<void> {
  const repo = process.env.STORE_REGISTRY_REPO;
  const token = process.env.GITHUB_TOKEN;
  const record = buildListingRecord(ext, version);

  if (!repo || !token) {
    console.log(`[store:mirror] (no-op, set STORE_REGISTRY_REPO + GITHUB_TOKEN) would publish ${ext.slug}@${version.version}`);
    return;
  }

  // Mirrors to the registry dir; STORE_REGISTRY_REPO may be this monorepo
  // (apps/extensions/registry) or a dedicated registry repo (registry/).
  const path = `${process.env.STORE_REGISTRY_PREFIX || 'apps/extensions/registry'}/${ext.slug}/listing.json`;
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const branch = process.env.STORE_REGISTRY_BRANCH || 'main';
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'tronbrowser-store',
    'content-type': 'application/json',
  };

  try {
    // Need the current blob sha to update an existing file.
    let sha: string | undefined;
    const cur = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers });
    if (cur.ok) sha = (await cur.json() as any).sha;

    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `publish: ${ext.slug}@${version.version}`,
        content: Buffer.from(JSON.stringify(record, null, 2) + '\n').toString('base64'),
        branch,
        sha,
      }),
    });
    if (!res.ok) console.error(`[store:mirror] github ${res.status}: ${await res.text()}`);
    else console.log(`[store:mirror] published ${path} to ${repo}`);
  } catch (e: any) {
    console.error('[store:mirror] failed:', e?.message ?? e);
  }
}
