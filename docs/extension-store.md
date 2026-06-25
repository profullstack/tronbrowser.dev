# Extension Store — architecture

> Recreate a browser-extension store so publishers skip the Chrome/Edge/Firefox
> review gauntlet: **pay $1, list your MV3 extension, go live instantly.** Keep
> Chromium's real format; delete only the bureaucracy.

Lives at **tronbrowser.dev/store**. Code: `apps/extensions/` (static frontend) +
`services/api/src/store/` (backend) + `packages/storage/migrations/0003_*`.

## The hard constraint (why "install model = universal sideload")

Browsers actively block third-party extension installs, so a pure off-store
store can't give true one-click on stock browsers:

| Browser | Off-store install reality |
|---|---|
| **Chrome (Win/macOS)** | Disabled by Chrome. Dev-mode "Load unpacked" works; auto-updating `.crx` only via Linux or enterprise policy. |
| **Edge** | Same as Chrome (Chromium). |
| **Firefox** | Must be Mozilla-signed. "Unlisted" AMO signing = self-distribute without listing; or unbranded/Nightly to disable signing. |
| **TronBrowser** | Our own Chromium build → **real one-click + auto-update**. |

So: TronBrowser gets one-click; everyone else gets a download + an honest
per-browser sideload guide (`install-guide.html`). We do **not** reinvent the
format — MV3 manifest, CRX3 packaging, and the gupdate `update_url` XML all stay
exactly as Chromium expects.

## Data model (`0003_extension_store.sql`)

- `extensions` — listing (slug, owner, status `draft|live|removed`)
- `extension_versions` — per-version MV3 manifest + bundle/CRX URLs (`manifest_version` enforced = 3 at the app layer)
- `extension_payments` — the $1 fee; `stripe|coinpay|x402`; `pending|paid|failed`
- `extension_scans` — async vu1nz results; non-gating badge
- `extension_flags` — community flagging

## Publish flow

```
create draft ─▶ submit MV3 version ─▶ pay $1 ─▶ LIVE (instant)
  POST /extensions   POST .../versions   POST .../checkout      │
                     (validateManifest)   Stripe or x402         ├─▶ git mirror (registry/)
                                          webhook/confirm        └─▶ vu1nz scan (async badge)
```

Two publish paths (both supported):
1. **Upload form** (`submit.html`) → API writes the listing + mirrors to git.
2. **Pull request** to `apps/extensions/registry/<slug>/listing.json` → the
   `extension-scan.yml` workflow runs vu1nz as the PR check.

Publishing is **instant after payment** — the vu1nz scan and git mirror happen
out of band and never block going live ("scan + community flagging", not
pre-review).

## Payments (`store/payments.ts`, dependency-free)

- **Stripe** — Checkout Session created server-side; `checkout.session.completed`
  webhook (HMAC-verified, replay-protected) marks the payment paid → publish.
- **CoinPay / x402** — `/checkout` returns an HTTP-402 challenge (1 USDC); the
  client settles via the CoinPay wallet and calls `/confirm` with the reference.
  Real settlement verification (`confirmCoinPaySettlement`) lands post-stub; it
  refuses to mark paid without a verified settlement unless `STORE_X402_TRUST_CLIENT=1` (dev).

## Security scan — vu1nz.com (`store/vu1nz.ts`)

Fire-and-forget after a version is submitted: `POST $VU1NZ_API_URL/scan/extension`
with the manifest + permissions + bundle URL; result stored in `extension_scans`
and shown as a 🛡 badge. If `VU1NZ_API_URL` is unset the scan is recorded
`skipped` so the store works without a scanner wired. The same scan runs as a
GitHub Action check on the PR path.

## Endpoints (`/api/store`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/extensions` | browse/search live listings |
| GET | `/extensions/:slug` | listing detail (+ scan, flags) |
| POST | `/extensions` | create draft (auth) |
| POST | `/extensions/:id/versions` | submit MV3 version (auth) |
| POST | `/extensions/:id/checkout` | start $1 payment (auth) |
| POST | `/extensions/:id/confirm` | confirm x402 settlement (auth) |
| POST | `/payments/stripe/webhook` | Stripe webhook |
| POST | `/extensions/:slug/flag` | community flag |
| GET | `/updates.xml?id=` | Chromium gupdate manifest (auto-update) |
| GET | `/extensions/:slug/download` | redirect to CRX/bundle |

## Env

See `.env.example` (Extension store section): `APP_URL`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STORE_X402_NETWORK`, `STORE_X402_PAY_TO`,
`VU1NZ_API_URL`, `VU1NZ_API_KEY`, `STORE_REGISTRY_REPO`, `GITHUB_TOKEN`.

## Not yet wired (follow-ups)

- **Direct bundle upload** to Cloudflare R2 (per CLAUDE.md stack) — today
  publishers host the `.crx`/`.zip` and link it; an `/upload` endpoint that
  pushes to R2 and returns the URL is the next step.
- **Server-side CRX3 signing** from an uploaded `.zip`.
- **Real CoinPay settlement verification** + Stripe live keys.
- **TronBrowser one-click** deep-link handler in the desktop app.
- **Admin/moderation UI** for resolving flags.
