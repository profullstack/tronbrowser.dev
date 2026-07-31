# @tronbrowser/extensions

The **TronBrowser extension store** — served at **tronbrowser.dev/store**.

Pay **$1**, list your **Manifest V3** extension, go **live instantly**. No review
queue, no $5 developer fee, no screenshots, no multi-day waits. We keep
Chromium's real plumbing (MV3 manifests, CRX3 packaging, `update_url`
auto-update) and only delete the bureaucracy.

## What's here

This package is the **static frontend** (`public/`). All dynamic behaviour lives
in the API at **`/api/store`** (see `services/api/src/store/`).

```
public/
  index.html          browse / search live extensions
  extension.html      listing detail: install, permissions, scan badge, report
  submit.html         publish flow: paste MV3 manifest → pay $1 → live
  install-guide.html  honest per-browser sideload steps + TronBrowser one-click
  store.css store.js  shared styles + CSP-safe client
registry/             git mirror of published listings (audit trail)
```

In production the Dockerfile copies `public/` to `/srv/store/` and Caddy serves
it; `/api/*` is reverse-proxied to the bundled Hono API.

## Install model (universal sideload)

- **TronBrowser** — true one-click install + auto-update (our Chromium build).
- **Chrome / Edge** — Load unpacked `.zip` (dev mode, any OS), or the
  auto-updating `.crx` via Linux / enterprise policy.
- **Firefox** — temporary load for any build; permanent install needs Mozilla
  "unlisted" AMO signing.

See `install-guide.html` for the full steps and why stock browsers can't offer a
one-click off-store install.

## Publish flow

1. `POST /api/store/extensions` — create a draft (auth required).
2. `POST /api/store/extensions/:id/versions` — submit the MV3 manifest + bundle
   URL(s). Rejected unless it's valid Manifest V3.
3. `POST /api/store/extensions/:id/checkout` — pay the $1 fee via **Stripe**
   (card) or **CoinPay / x402** (1 USDC).
4. On payment the listing flips to **live**, is mirrored to the git registry,
   and a **vu1nz.com** security scan runs asynchronously (badge on the listing).

You can also publish **via a PR** to `registry/<slug>/listing.json` — the vu1nz
scan runs as the PR's CI check.

## Develop

```bash
pnpm --filter @tronbrowser/extensions serve   # static preview on :4322
pnpm --filter @tronbrowser/api dev            # the /api/store backend
```

See [`docs/extension-store.md`](../../docs/extension-store.md) for architecture
and env vars.
