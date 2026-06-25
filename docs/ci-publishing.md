# CI/CD publishing to the TronBrowser store

Publish a new version of your extension automatically from git — on every tag or
push — instead of using the web form. Works from GitHub Actions, GitLab CI, or any
shell.

## How it works

1. **One-time setup (web UI):** create the listing and pay the one-time **$1**
   fee at `https://tronbrowser.dev/store/submit.html`, and register your **SSH
   key** (the publisher identity that can upload to files.profullstack.com).
2. **Mint a publisher API token** (shown once) — your CI uses it instead of a
   browser session.
3. **Each CI run** builds your MV3 bundle, `scp`s it to
   `files.profullstack.com`, and registers the new version via the store API.
   Listings update **free and instantly** after the initial paid listing.

## 1. Mint a publisher token

Signed in, from a browser session:

```bash
curl -X POST https://tronbrowser.dev/api/store/publisher/tokens \
  -H 'content-type: application/json' --cookie 'tb_session=…' \
  -d '{"name":"github-actions"}'
# => { "ok": true, "token": "tbpub_…", ... }   # store the token now — shown once
```

List or revoke: `GET /api/store/publisher/tokens`, `DELETE /api/store/publisher/tokens/:id`.

## 2. Add CI secrets

| Secret | Value |
| --- | --- |
| `TRONBROWSER_STORE_TOKEN` | the `tbpub_…` token from step 1 |
| `TRONBROWSER_SSH_KEY` | the **private** SSH key whose public key is registered with your publisher account |

## 3. The publish step

It calls [`scripts/publish-extension.sh`](../scripts/publish-extension.sh).
Required env: `TRONBROWSER_STORE_TOKEN`, `TRONBROWSER_SSH_KEY`, `STORE_SLUG`.
Optional: `STORE_URL`, `SCP_TARGET`, `MANIFEST` (default `manifest.json`),
`BUNDLE` (dir to zip, or a `.zip`/`.crx`; default `dist`). Needs `jq`, `curl`,
`ssh`/`scp`, `zip` (all preinstalled on `ubuntu-latest`).

### GitHub Actions (paste into your extension's repo)

```yaml
name: Publish to TronBrowser store
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build      # produce ./dist
      - name: Publish
        env:
          TRONBROWSER_STORE_TOKEN: ${{ secrets.TRONBROWSER_STORE_TOKEN }}
          TRONBROWSER_SSH_KEY: ${{ secrets.TRONBROWSER_SSH_KEY }}
          STORE_SLUG: my-extension
          BUNDLE: dist
          MANIFEST: dist/manifest.json
        run: curl -fsSL https://raw.githubusercontent.com/profullstack/tronbrowser.dev/main/scripts/publish-extension.sh | bash
```

### Any other CI / local

```bash
export TRONBROWSER_STORE_TOKEN=tbpub_…
export TRONBROWSER_SSH_KEY="$(cat ~/.ssh/id_ed25519)"
export STORE_SLUG=my-extension BUNDLE=dist
./scripts/publish-extension.sh
```

## Notes

- The version number comes from your `manifest.json` `version` — bump it each
  release or Chromium won't auto-update clients.
- The first publish for a slug must be the paid web listing; CI handles every
  version after that.
- Tokens are long-lived and revocable; treat them like a deploy key.
