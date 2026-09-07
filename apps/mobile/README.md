# @tronbrowser/mobile

TronBrowser mobile **companion** app (iOS + Android) — **Expo / React Native**,
Expo SDK 57. See [`docs/mobile-architecture.md`](../../docs/mobile-architecture.md)
for how this fits the three mobile tracks.

Build prerequisites and the EAS access checklist are documented in
[`BUILD_READINESS.md`](BUILD_READINESS.md).

> **This is the companion app, not the engine.** It uses the *system* WebView
> (WKWebView on iOS — mandatory; system WebView on Android), so it is **not** the
> Ungoogled Chromium engine and has **no Chrome extensions / no bundled Tor**.
> The real engine + Tor ship via the desktop/Linux-phone build and the native
> Android build — again, see the architecture doc.

## Run

```bash
cd apps/mobile
pnpm start            # Expo dev server (then press i / a)
pnpm ios              # native iOS run (needs Xcode)
pnpm android          # native Android run (needs Android SDK)
pnpm export           # bundle JS for all platforms (CI build proof)
pnpm typecheck        # tsc --noEmit
```

Bundle ids: `dev.tronbrowser.app` (iOS + Android).

## Features

Implemented screens (tabbed shell, `App.tsx`). Every tab stays mounted across
switches — WebView history/scroll, chat messages, and drafts survive — while
inactive tabs are hidden from touch and accessibility. Safe areas come from
`react-native-safe-area-context` (Android 15/16 edge-to-edge), not React
Native's deprecated iOS-only `SafeAreaView`.

- **Browse** — in-app browser via `react-native-webview` (system engine),
  URL/search bar with a DuckDuckGo default that needs no account (the desktop
  correction), back/forward/reload. Android hardware Back walks page history
  only while this tab is active; `window.open` / `target="_blank"` opens in
  the same tab after HTTP(S) validation; third-party cookies are blocked on
  Android (on iOS the WKWebView cookie policy belongs to WebKit).
- **Chat** — AI chat UI; the provider seam is `src/lib/ai.ts`
  (set `EXPO_PUBLIC_AI_ENDPOINT`, else offline echo).
- **Agents** — agent dashboard (sample data → wire `@tronbrowser/agent-runtime`).
- **Settings** — sync/privacy/about + Tor status note.

Still to wire (PRD §Mobile): real model provider, sync backend, voice,
push notifications.

## Tests

`pnpm test` runs the URL/search unit tests plus component tests that render
the real `App`/screens with only the native boundary mocked (`test/mocks/*`,
aliased in `vitest.config.ts`): tab-state preservation, hardware-Back policy,
safe-area insets, `window.open` handling, and platform cookie wording.

## EAS (builds & submission)

Linked to the EAS project **profullstack/tronbrowserdev**
(`projectId d8bd3b92-f0e1-492e-bf3f-b972d7afec4f`, see `app.json` → `extra.eas`).
Profiles are in [`eas.json`](eas.json).

```bash
eas build --platform android --profile preview
eas build --platform ios --profile production
eas submit --platform android
```

**Monorepo note:** in the EAS GitHub integration
(expo.dev → project → GitHub), set the **Base directory** to `apps/mobile` for
both Android and iOS — that's where this Expo app lives.
