# TronBrowser Android engine — Chromium fork

The experimental pipeline for evaluating upstream Chromium + Ungoogled
Chromium as a **native TronBrowser APK** for Android. This is not yet an
accepted production base; see
[ADR 0001](../../../docs/adr/0001-chromium-fork-base.md),
[ADR 0002](../../../docs/adr/0002-android-engine-source-strategy.md), and
[`../../desktop/chromium/`](../../desktop/chromium/).

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
  patches/              # required TronBrowser Android overlay (after ungoogled)
  scripts/              # fetch / sync / apply-patches / build / package / sign / tor
```

## Readiness

```bash
node scripts/preflight.mjs --mode scaffold
node scripts/preflight.mjs --mode checkout
node scripts/preflight.mjs --mode release
```

Scaffold mode validates configuration and reports unresolved release inputs.
Checkout mode checks the build host and reports release blockers without
requiring release approval, so maintainers can develop patches against a real
checkout. Release mode refuses to continue while the Chromium pin, required
patches, branding assets, or pinned Tor integration are unapproved or missing.

## Build (100GB+ free disk, 16GB+ RAM recommended, hours, Linux x64)

Scripts are **guarded**: they dry-run unless `TB_RUN=1`. Source lands outside the
repo in `$TB_WORKDIR` (default `~/.cache/tronbrowser-android-chromium`). Pick the
CPU with `TB_TARGET_CPU` (`arm64` default; `arm64 | arm`).

```bash
TB_RUN=1 ./scripts/fetch.sh          # depot_tools + ungoogled + chromium (target_os=android)
TB_RUN=1 ./scripts/sync.sh           # gclient hooks (Android SDK/NDK)
TB_RUN=1 ./scripts/apply-patches.sh  # ungoogled + TronBrowser Android series + branding
TB_RUN=1 ./scripts/tor.sh            # stage bundled Tor (SOCKS5) asset
TB_RUN=1 ./scripts/build.sh          # gn gen + autoninja chrome_public_apk + bundle
TB_RUN=1 ./scripts/package.sh        # collect .apk/.aab into $TB_WORKDIR/dist
TB_KEYSTORE=... TB_RUN=1 ./scripts/sign.sh   # sign with release keystore
```

The manual GitHub Actions build also requires
`TRONBROWSER_ANDROID_KEYSTORE_BASE64`,
`TRONBROWSER_ANDROID_KEYSTORE_PASSWORD`,
`TRONBROWSER_ANDROID_KEY_ALIAS`, and, when different from the keystore
password, `TRONBROWSER_ANDROID_KEY_PASSWORD`. The workflow refuses to publish
an unsigned artifact.

## Privacy posture

- Compile-time: [`config/gn-args/common.gni`](config/gn-args/common.gni) empties
  Google API keys and disables reporting/RLZ/Safe-Browsing phone-home.
- Planned patch-time work: [`patches/series`](patches/series) lists residual
  telemetry, sponsored-surface, GMS/GCM, and Tor-toggle patches. Their bodies
  are release blockers until implemented and tested.
- Planned run-time work: privacy-leaning defaults and Tor via bundled SOCKS5.

## Why this is a separate, large track

A full Android Chromium product is a large native effort (GN/ninja, large
runners, signing infra, and recurring rebases). iOS cannot use this engine
(WebKit-mandated). The scaffold is structurally CI-validated, but it is not an
APK claim: filling and testing the Android patches/assets, pinning Tor, updating
the security version, and running the first heavy build are separate milestones.
