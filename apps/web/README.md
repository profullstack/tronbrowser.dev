# @tronbrowser/web

Marketing site + web dashboard for TronBrowser.

## Homepage & installer

[`public/`](public/) holds the static homepage and the hosted install script:

- `public/index.html` — landing page; leads with the `curl | sh` install method.
- `public/install.sh` — served at **https://tronbrowser.dev/install.sh**.

```bash
# one-line install:
curl -fsSL https://tronbrowser.dev/install.sh | sh
```

The installer detects OS/arch, pulls the latest GitHub release artifact, installs
under `$TRONBROWSER_PREFIX` (default `~/.local`), and drops a **`tron`** CLI onto
`$PREFIX/bin` (with a `tronbrowser` alias). After install, manage it with `tron`:

```bash
tron            # launch the browser (tron <url> opens URLs)
tron upgrade    # update to the latest release
tron remove     # uninstall (keeps your profile data)
tron version    # print the installed version
```

The bootstrap installer also accepts `… | sh -s -- {install,upgrade,remove,version,help}`
for use before `tron` exists on PATH.

Preview the static site locally:

```bash
pnpm --filter @tronbrowser/web serve   # python3 http.server on :4321
```

## Scripts

- `pnpm build` / `pnpm typecheck` / `pnpm test`
- `pnpm serve` — serve `public/` for local preview

See the [PRD](../../docs/tronbrowser-prd.md).
