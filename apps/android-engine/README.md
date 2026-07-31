# @tronbrowser/android-engine

**Track 3** (see [`docs/mobile-architecture.md`](../../docs/mobile-architecture.md)):
the **native de-googled Chromium browser for Android** — the real Ungoogled
Chromium engine + bundled Tor, built as an `.apk`/`.aab` (Bromite/Cromite-style).

> **This is the engine, not the companion.** `apps/mobile` is the Expo companion
> on the *system* WebView (and the only iOS path). This package is a full native
> Chromium fork for Android — no Expo, no React Native. It is the Android
> counterpart of `apps/desktop/chromium/`.

## Status

**Skeleton complete + CI-validated. The heavy build is not yet run.**

- ✅ Build pipeline: [`chromium/scripts/`](chromium/scripts) fetch → sync →
  apply-patches → tor → build → package → sign, all guarded by `TB_RUN=1`.
- ✅ Config: pinned versions, GN args (privacy + Android target), branding,
  patch series (roadmap) — see [`chromium/`](chromium/README.md).
- ⬜ Patch bodies (`chromium/patches/tronbrowser-android/*.patch`).
- ⬜ First real compile (needs a large Linux runner; ~50GB checkout, hours).
- ⬜ Signing keystore + Play/F-Droid publishing.

## Build

See [`chromium/README.md`](chromium/README.md). TL;DR (Linux host):

```bash
cd apps/android-engine/chromium
TB_RUN=1 TB_TARGET_CPU=arm64 ./scripts/fetch.sh
TB_RUN=1 ./scripts/sync.sh && TB_RUN=1 ./scripts/apply-patches.sh
TB_RUN=1 ./scripts/build.sh && TB_RUN=1 ./scripts/package.sh
```

CI ([`.github/workflows/android-engine.yml`](../../.github/workflows/android-engine.yml))
validates the skeleton on every push and exposes a manual heavy-build dispatch.

## Distinct app id

The native engine is `dev.tronbrowser.browser` (the Expo companion is
`dev.tronbrowser.app`) so both can coexist on a device and the Play Store.
