# Mobile & Small-Screen Architecture

> Status: **active** (started 2026-07). Supersedes the "Phase 2 stub" note in
> `apps/mobile/README.md`. Source of truth for how TronBrowser reaches phones.

TronBrowser's desktop differentiator is that **it is its own Ungoogled Chromium
fork** with a bundled `tor` daemon (`apps/desktop/src/tor.ts`) routing Chromium
over SOCKS5, plus Chrome-extension compatibility, profiles, and history.

The central mobile question is therefore: **can we carry the engine (and Tor)
onto a device?** The answer is decided by the OS, not by effort. This yields
**three distinct tracks**, only one of which is an Expo app.

---

## The engine-portability matrix

| Target | Own engine (Ungoogled Chromium)? | Chrome extensions? | Tor | Vehicle |
|---|---|---|---|---|
| **Linux phones** (Ubuntu Touch, Librem 5, PinePhone) | ✅ yes — real desktop build (arm64) | ✅ yes | ✅ bundled `tor` daemon, full parity | `distribution/` packaging |
| **Android** | ⚠️ yes, but only via a **native Chromium build** (Bromite-scale), *not* Expo | ⚠️ engine-dependent | ⚠️ possible (bundled `tor`/Orbot + SOCKS5), native module | Bare native build |
| **Android** (Expo companion) | ❌ no — system WebView only | ❌ no | later, via native module | Expo / RN |
| **iOS** | ❌ **never** — Apple mandates WebKit (WKWebView) | ❌ no | ⚠️ in-app only (Tor.framework + WKWebView proxy), shell not engine | Expo / RN |

**Key consequence:** iOS can *only* be a WebKit shell. The Expo companion is the
only thing that ships to iOS at all. The engine lives on **Android (native
build)** and **Linux phones (desktop build)**.

---

## Track 1 — Expo companion app (`apps/mobile`)

**Scope (PRD §Mobile Phase 2):** AI chat · sync · voice · push · agent
dashboard, plus a **basic in-app browser** via `react-native-webview` (system
engine — WebKit on iOS, system WebView on Android). Ships to **both** App Store
and Play Store. This is the fastest path and the *only* iOS path.

- **Not** the Ungoogled Chromium engine. It is a companion + convenience browser.
- Reuses shared TS from `packages/*` (e.g. `@tronbrowser/ai-core`, `shared`).
- Stack: Expo SDK, React Native, `react-native-webview`, expo-router or
  React Navigation, `expo-notifications` (push), `expo-speech`/mic (voice).
- Tor on this track is a **later native add-on** (Android: Orbot/`tor` +
  SOCKS5; iOS: Tor.framework), not part of the initial companion.

## Track 2 — Linux phones (full engine parity) — **started**

**Scope:** ship the **real arm64 build** — the noarch `tron` launcher driving
Ungoogled Chromium + the bundled `tor` SOCKS5 helper, Chrome extensions, the
full feature set — to Linux phones. This is **packaging, not an app rewrite**:
the desktop launcher tree is arch-independent (shell + extensions + SVG/PNG), so
the same staged tree yields amd64 *and* arm64 artifacts.

Landed:

- **arm64 `.deb` / `.rpm`** (Librem 5 / PureOS, PinePhone / Mobian,
  postmarketOS) — `distribution/deb-rpm/` is arch-parameterized; `build.sh`
  emits amd64+arm64 by default. Adds a `.desktop` entry + icon so TronBrowser
  shows in the Phosh / Plasma-Mobile app grid; `Depends: chromium | … `,
  `Recommends: tor`. Built in `release.yml` (attached to releases) and validated
  per-push in `.github/workflows/linux-phones.yml`.
- **Ubuntu Touch `click`** — `distribution/ubuntu-touch/` (Clickable `pure`
  builder). **Constraint:** UT confines apps and ships Morph/Oxide, not desktop
  Chromium, so the real engine runs inside a **Libertine** container
  (`tronbrowser-ut` → `libertine-launch` → bundled `tron`). Needs an
  `unconfined` AppArmor profile → sideload / OpenStore unconfined track. CI
  stages + JSON-validates the click; a full `.click` needs Clickable installed.

Still open: adaptive/mobile window sizing tweaks; publishing (OpenStore submit,
arm64 apt repo or Flatpak arm64 on Flathub).

## Track 3 — Android full engine (native Chromium) — **skeleton started**

**Scope:** a separate **native Android Chromium build** (Bromite/Cromite-style)
carrying the de-googled engine + hardening + bundled `tor` (SOCKS5). The *only*
way to get the real engine + Chrome-extension power on Android. Lives in
[`apps/android-engine/`](../apps/android-engine/README.md), the Android
counterpart of `apps/desktop/chromium/`.

Landed (skeleton, CI-validated):

- **Build pipeline** `apps/android-engine/chromium/scripts/`: fetch → sync →
  apply-patches → tor → build → package → sign, all guarded by `TB_RUN=1`
  (dry-run by default; source lands outside the repo in `$TB_WORKDIR`).
- **Config**: pinned `version.json` (chromium + ungoogled, `target_os=android`,
  `chrome_public_apk`/`_bundle`, tor-android), GN args (`common.gni` privacy +
  `android.gni` target), branding (`dev.tronbrowser.browser` — distinct from the
  companion's `dev.tronbrowser.app`).
- **Patch series** (roadmap): branding, telemetry residual, sponsored removal,
  default search/newtab, **strip GMS/GCM**, **extension support**, **Tor proxy
  toggle**, privacy defaults.
- **CI** `.github/workflows/android-engine.yml`: `validate` job proves the
  skeleton on every push (parses config, `bash -n`, checks the dry-run guard);
  `build-apk` is a manual opt-in dispatch (needs a large/self-hosted Linux
  runner — ~50GB checkout, hours).

Still open: fill the `patches/tronbrowser-android/*.patch` bodies; first real
compile on a big runner; signing keystore + Play/F-Droid publishing.

**Reminder:** iOS can never have this (WebKit-mandated). This + Track 2 are the
only routes to the real Ungoogled-Chromium engine on a phone.

---

## Sequencing

1. **Track 1 (Expo companion)** — start now; only iOS path; reuses existing
   `app.json` + `eas.json` (EAS project `profullstack/tronbrowserdev`).
2. **Track 2 (Linux phones)** — packaging; high parity payoff, moderate effort.
3. **Track 3 (Android engine)** — largest; plan first, build later.

## What "keep Ungoogled Chromium on mobile" means, precisely

- **Yes** on Linux phones (Track 2) and Android via native build (Track 3).
- **No** on iOS — impossible by Apple policy; iOS is a WebKit companion (Track 1).
