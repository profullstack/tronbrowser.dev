# TronBrowser Android engine — Chromium fork

The build pipeline that turns upstream Chromium + Ungoogled Chromium into the
**native de-googled TronBrowser APK** for Android (Bromite/Cromite-style). Base:
**Ungoogled Chromium**, same pin as desktop (see
[ADR 0001](../../../docs/adr/0001-chromium-fork-base.md) and
[`../../desktop/chromium/`](../../desktop/chromium/)).

This is **not** the Expo companion app (`apps/mobile`, system WebView). This is
the real engine — see [`docs/mobile-architecture.md`](../../../docs/mobile-architecture.md)
Track 3.

## Layout

```
chromium/
  config/
    version.json        # pinned chromium + ungoogled versions, targets, tor
    gn-args/            # common.gni + android.gni (privacy + branding)
  branding/             # product strings + APK icon assets
  patches/              # TronBrowser Android patch series (after ungoogled)
  scripts/              # fetch / sync / apply-patches / build / package / sign / tor
```

## Build (large: ~50GB+ checkout + Android SDK/NDK, hours to compile, Linux only)

Scripts are **guarded**: they dry-run unless `TB_RUN=1`. Source lands outside the
repo in `$TB_WORKDIR` (default `~/.cache/tronbrowser-android-chromium`). Pick the
CPU with `TB_TARGET_CPU` (arm64 default; arm | x64).

```bash
TB_RUN=1 ./scripts/fetch.sh          # depot_tools + ungoogled + chromium (target_os=android)
TB_RUN=1 ./scripts/sync.sh           # gclient hooks (Android SDK/NDK)
TB_RUN=1 ./scripts/apply-patches.sh  # ungoogled + TronBrowser Android series + branding
TB_RUN=1 ./scripts/tor.sh            # stage bundled Tor (SOCKS5) asset
TB_RUN=1 ./scripts/build.sh          # gn gen + autoninja chrome_public_apk + bundle
TB_RUN=1 ./scripts/package.sh        # collect .apk/.aab into $TB_WORKDIR/dist
TB_KEYSTORE=... TB_RUN=1 ./scripts/sign.sh   # sign with release keystore
```

## Privacy posture

- Compile-time: [`config/gn-args/common.gni`](config/gn-args/common.gni) empties
  Google API keys and disables reporting/RLZ/Safe-Browsing phone-home.
- Patch-time: [`patches/series`](patches/series) strips residual telemetry,
  sponsored surfaces, and Android GMS/GCM, and adds the Tor toggle.
- Run-time: privacy-leaning defaults (patch 0008), Tor via bundled SOCKS5.

## Why this is a separate, large track

A full Android Chromium build is a months-long native effort (GN/ninja, big
runners, signing infra). iOS can never match it (WebKit-mandated). The desktop
and Linux-phone builds already deliver full parity; this brings the same engine
to stock Android. The skeleton here is complete and CI-validated; filling the
`patches/tronbrowser-android/*.patch` bodies + running the heavy build is next.
