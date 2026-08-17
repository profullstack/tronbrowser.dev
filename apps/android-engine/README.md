# @tronbrowser/android-engine

**Track 3** (see [`docs/mobile-architecture.md`](../../docs/mobile-architecture.md)):
the planned **native de-googled Chromium browser for Android** — an evaluated
path toward an Ungoogled Chromium engine and optional bundled Tor, built as an
`.apk`/`.aab` (Bromite/Cromite-style).

> **This is the engine, not the companion.** `apps/mobile` is the Expo companion
> on the *system* WebView (and the only iOS path). This package is a full native
> Chromium fork for Android — no Expo, no React Native. It is the Android
> counterpart of `apps/desktop/chromium/`.

## Status

**Scaffold validated. Release inputs and the first heavy build are still open.**

- ✅ Guarded pipeline and a tested release-readiness preflight.
- ✅ Source evaluation and conditional recommendation documented in
  [ADR 0002](../../docs/adr/0002-android-engine-source-strategy.md).
- ✅ A pinned Cromite candidate snapshot and offline adoption gate record
  license, release-lag, freshness, and extension-support decisions without
  treating external attestations as a verified build.
- ⬜ Patch bodies (`chromium/patches/tronbrowser-android/*.patch`), real
  Android branding assets, and pinned/checksummed Tor artifacts.
- ⬜ Current Chromium security pin and first real compile (Linux x64, at least
  100GB free, more than 16GB RAM recommended).
- ⬜ Signing keystore + Play/F-Droid publishing.

## Build

See [`chromium/README.md`](chromium/README.md). TL;DR (Linux host):

```bash
cd apps/android-engine/chromium
node scripts/preflight.mjs --mode scaffold
# Validate the recorded source snapshot without claiming it is adoptable.
node scripts/audit-candidate.mjs --mode record
node scripts/audit-candidate.mjs --mode adopt  # fails while decisions are open
# Checkout mode checks the host and reports release blockers before downloading.
node scripts/preflight.mjs --mode checkout
# Release mode additionally requires every patch, asset, and Tor input.
node scripts/preflight.mjs --mode release
TB_RUN=1 TB_TARGET_CPU=arm64 ./scripts/fetch.sh
TB_RUN=1 ./scripts/sync.sh && TB_RUN=1 ./scripts/apply-patches.sh
TB_RUN=1 ./scripts/build.sh && TB_RUN=1 ./scripts/package.sh
```

CI ([`.github/workflows/android-engine.yml`](../../.github/workflows/android-engine.yml))
validates the scaffold and candidate-record structure on every push. The manual
heavy-build dispatch fails until the strict release preflight is clean; local
source checkout remains available so the missing overlay can be developed and
rebased.

## Distinct app id

The native-engine ID is configured as `dev.tronbrowser.browser` (the Expo
companion is `dev.tronbrowser.app`) so both can coexist. The first real APK
must still be inspected to verify that the generated manifest uses this ID.
