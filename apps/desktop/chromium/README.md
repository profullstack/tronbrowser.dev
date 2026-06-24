# TronBrowser Chromium fork

The build pipeline that turns upstream Chromium + Ungoogled Chromium into the
TronBrowser binary. Base: **Ungoogled Chromium** (see
[ADR 0001](../../../docs/adr/0001-chromium-fork-base.md)).

## Layout

```
chromium/
  config/
    version.json        # pinned chromium + ungoogled versions
    gn-args/            # compile-time build args (privacy + branding)
  branding/             # product strings + icon assets
  patches/              # TronBrowser patch series (applied after ungoogled)
  scripts/              # fetch / sync / apply-patches / build / package
```

## Build (the real thing is large: ~50GB checkout, hours to compile)

The scripts are **guarded**: they dry-run unless `TB_RUN=1` is set. Source lands
outside the repo in `$TB_WORKDIR` (default `~/.cache/tronbrowser-chromium`).

```bash
TB_RUN=1 ./scripts/fetch.sh          # depot_tools + ungoogled + chromium src
TB_RUN=1 ./scripts/sync.sh           # gclient hooks
TB_RUN=1 ./scripts/apply-patches.sh  # ungoogled patches + TronBrowser series + branding
TB_RUN=1 ./scripts/build.sh          # gn gen + autoninja
TB_RUN=1 ./scripts/package.sh        # tarball / zip
```

## Privacy posture

- Compile-time: [`config/gn-args/common.gni`](config/gn-args/common.gni) empties
  Google API keys and disables reporting/RLZ/Safe-Browsing phone-home.
- Patch-time: [`patches/`](patches/) strips residual telemetry and all sponsored
  / affiliate surfaces.
- Run-time: [`../src/chromium-flags.ts`](../src/chromium-flags.ts) adds
  privacy launch flags by default and refuses any sponsored/affiliate flag.

Preserved from upstream (PRD §Desktop): Chrome extensions, profiles, bookmarks,
downloads, history, PWAs, DevTools.
