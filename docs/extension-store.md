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
- `extension_payments` — the $1 fee; `coinpay` (older rows may say `stripe`/`x402`); `pending|paid|failed`
- `extension_scans` — async vu1nz results; non-gating badge
- `extension_flags` — community flagging

## Publish flow

```
create draft ─▶ submit MV3 version ─▶ pay $1 ─▶ LIVE (instant)
  POST /extensions   POST .../versions   POST .../checkout      │
                     (validateManifest)   CoinPay checkout       ├─▶ git mirror (registry/)
                                          CoinPay webhook        └─▶ vu1nz scan (async badge)
```

Two publish paths (both supported):
1. **Upload form** (`submit.html`) → API writes the listing + mirrors to git.
2. **Pull request** to `apps/extensions/registry/<slug>/listing.json` → the
   `extension-scan.yml` workflow runs vu1nz as the PR check.

Publishing is **instant after payment** — the vu1nz scan and git mirror happen
out of band and never block going live ("scan + community flagging", not
pre-review).

## Payments (`store/payments.ts`)

One rail: a **CoinPay hosted checkout session** (`@profullstack/coinpay-onboard`).
`/checkout` records a pending `extension_payments` row, creates a session for $1
(customer_email = owner email, account_id = user id, property `tronbrowser.dev`,
metadata `{extension_id, payment_id, slug}`), stores the `cs_...` id as
`provider_ref` and returns `checkoutUrl`. The publisher picks any coin or PayPal
on CoinPay's page. CoinPay posts `payment.confirmed` / `payment.forwarded` to
`/payments/coinpay/webhook` (X-CoinPay-Signature, HMAC over the raw body); that
marks the row paid (idempotent) and publishes. `/confirm` with `{sessionId}`
reconciles by reading the session back with the API key.

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
| POST | `/extensions/:id/confirm` | reconcile a CoinPay checkout session (auth) |
| POST | `/payments/coinpay/webhook` | CoinPay webhook |
| POST | `/extensions/:slug/flag` | community flag |
| GET | `/updates.xml?id=` | Chromium gupdate manifest (auto-update) |
| GET | `/extensions/:slug/download` | redirect to CRX/bundle |

## Env

See `.env.example` (Extension store section): `APP_URL`, `COINPAY_API_URL`,
`COINPAY_API_KEY`, `COINPAY_WEBHOOK_SECRET`,
`VU1NZ_API_URL`, `VU1NZ_API_KEY`, `STORE_REGISTRY_REPO`, `GITHUB_TOKEN`.

## Bundle hosting — files.profullstack.com (AgentBBS Files)

Instead of a cloud object store, bundles live on **files.profullstack.com** —
the AgentBBS Files `/public` area (FOSS, self-hosted; replaces the lost Supabase
storage). It's reached over SFTP and keyed by SSH public key.

**Publisher identity (`0004_extension_publishers.sql`, `store/fileshost.ts`):**
each publisher gets one AgentBBS member, provisioned from their SSH public key.
The store either takes a pasted public key or generates an ed25519 keypair
(private key shown once via `ssh-keygen`), then **SSHes the BBS host and runs
`agentbbs provision-user`** (full-auto; see agentbbs PR #58). If
`BBS_SSH_*` is unset the key is saved and an operator provisions later.

**Upload + serve:**
```
scp dist.crx files@files.profullstack.com:/public/extensions/<slug>/
        ->  https://files.profullstack.com/public/extensions/<slug>/dist.crx
```
The dev gives the store the filenames; we derive the URL from the slug
convention (`publicUrlFor`) and **HEAD-check** the artifact is up before the
version goes live. Anonymous public download is served by Caddy on the BBS host
(`handle_path /public/*` → static `file_server`); the agentbbs PR adds it.

Requires `openssh-client` in the API image (for `ssh`/`ssh-keygen`) — added to
the Dockerfile.

## Not yet wired (follow-ups)

- **Browser file upload** (multipart straight through the API to files) so devs
  don't need an SCP client at all — today they `scp` (or use FileZilla).
- **Server-side CRX3 signing** from an uploaded `.zip`.
- **TronBrowser one-click** deep-link handler in the desktop app.
- **Admin/moderation UI** for resolving flags.
