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

## Track 2 — Linux phones (full engine parity)

**Scope:** ship the **real arm64 desktop build** — Ungoogled Chromium + bundled
`tor` daemon, Chrome extensions, the full feature set — to:

- **Ubuntu Touch** — package as a **click** app (Clickable). Chromium runs under
  Libertine / confinement caveats; document the confinement story.
- **Librem 5 (PureOS)** and **PinePhone (Mobian/postmarketOS)** — standard arm64
  `.deb`/Flatpak from `distribution/`, adaptive/mobile-friendly window.

This is **distribution/packaging work, not an app rewrite.** It is where "full
feature set incl. Tor on a phone" actually happens. Lives under `distribution/`
(new `ubuntu-touch/` for the click packaging).

## Track 3 — Android full engine (native Chromium)

**Scope:** a separate **native Android Chromium build** (Bromite/Cromite-style)
carrying the de-googled engine + hardening + bundled `tor` (SOCKS5). This is the
*only* way to get the real engine + Chrome-extension-like power on Android.

- **Not** an Expo app. Months-long native build pipeline (GN/ninja, patch set),
  analogous to `apps/desktop/chromium/`.
- Tor: bundle `tor` via a native lib (e.g. tor-android) or integrate Orbot;
  reuse the arg-building/bootstrap logic conceptually from `apps/desktop/src/tor.ts`.
- Deferred behind Track 1 & 2; skeleton/plan tracked here first.

---

## Sequencing

1. **Track 1 (Expo companion)** — start now; only iOS path; reuses existing
   `app.json` + `eas.json` (EAS project `profullstack/tronbrowserdev`).
2. **Track 2 (Linux phones)** — packaging; high parity payoff, moderate effort.
3. **Track 3 (Android engine)** — largest; plan first, build later.

## What "keep Ungoogled Chromium on mobile" means, precisely

- **Yes** on Linux phones (Track 2) and Android via native build (Track 3).
- **No** on iOS — impossible by Apple policy; iOS is a WebKit companion (Track 1).
