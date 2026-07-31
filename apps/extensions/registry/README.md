# Extension registry (git mirror)

The TronBrowser store's source of truth is the Turso DB (instant publish). Every
published listing is **also mirrored here** as `registry/<slug>/listing.json`,
giving an auditable, forkable, greppable trail of what's live.

## Two ways to publish

1. **Upload form** — [tronbrowser.dev/store/submit.html](https://tronbrowser.dev/store/submit.html):
   paste your `manifest.json`, link the bundle, pay $1. The store writes the
   `listing.json` here for you.

2. **Pull request** — add `registry/<your-slug>/listing.json` yourself and open a
   PR. The [vu1nz scan workflow](../../../.github/workflows/extension-scan.yml)
   runs as the PR check; once the $1 fee clears the PR merges and the listing
   goes live.

## `listing.json` shape

```json
{
  "slug": "acme-dark-mode",
  "name": "Acme Dark Mode",
  "summary": "A nice dark mode",
  "description": "…markdown…",
  "homepage_url": "https://example.com",
  "version": "1.0.0",
  "manifest_version": 3,
  "permissions": ["storage", "https://example.com/*"],
  "bundle_url": "https://…/ext.zip",
  "crx_url": "https://…/ext.crx",
  "bundle_sha256": "…",
  "published_at": "2026-06-25T00:00:00.000Z"
}
```

`manifest_version` **must** be `3` — the store is MV3-only.
