# @tronbrowser/web

Marketing site + web dashboard for TronBrowser.

## Homepage & installer

[`public/`](public/) holds the static homepage and the hosted install script:

- `public/index.html` — landing page; leads with the `curl | sh` install method.
- `public/install.sh` — served at **https://tronbrowser.dev/install.sh**.

```bash
# install (default), then the usual commands:
curl -fsSL https://tronbrowser.dev/install.sh | sh
curl -fsSL https://tronbrowser.dev/install.sh | sh -s -- upgrade
curl -fsSL https://tronbrowser.dev/install.sh | sh -s -- remove
curl -fsSL https://tronbrowser.dev/install.sh | sh -s -- version
```

The installer detects OS/arch, pulls the latest GitHub release artifact, installs
under `$TRONBROWSER_PREFIX` (default `~/.local`), and symlinks `tronbrowser` onto
`$PREFIX/bin`. `remove` keeps the user's profile/bookmarks/history.

Preview the static site locally:

```bash
pnpm --filter @tronbrowser/web serve   # python3 http.server on :4321
```

## Scripts

- `pnpm build` / `pnpm typecheck` / `pnpm test`
- `pnpm serve` — serve `public/` for local preview

See the [PRD](../../docs/tronbrowser-prd.md).
