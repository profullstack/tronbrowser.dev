# @tronbrowser/mobile

TronBrowser mobile **companion** app (iOS + Android) — **Expo / React Native**,
Expo SDK 57. See [`docs/mobile-architecture.md`](../../docs/mobile-architecture.md)
for how this fits the three mobile tracks.

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

Implemented screens (tabbed shell, `App.tsx`):

- **Browse** — in-app browser via `react-native-webview` (system engine),
  URL/search bar, back/reload, third-party cookies blocked.
- **Chat** — AI chat UI; the provider seam is `src/lib/ai.ts`
  (set `EXPO_PUBLIC_AI_ENDPOINT`, else offline echo).
- **Agents** — agent dashboard (sample data → wire `@tronbrowser/agent-runtime`).
- **Settings** — sync/privacy/about + Tor status note.

Still to wire (PRD §Mobile): real model provider, sync backend, voice,
push notifications.

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
