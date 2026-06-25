# @tronbrowser/mobile

TronBrowser mobile app (iOS + Android) — **Expo / React Native**, **Phase 2**
(PRD §Mobile).

> Status: **stub**. The Expo config (`app.json`) and entry screen (`App.tsx`)
> are scaffolded; the React Native toolchain is not installed yet to keep the
> workspace lockfile light. The `src/` TypeScript stub keeps it a valid
> workspace member and is what CI typechecks/builds.

## Start Phase 2

```bash
cd apps/mobile
pnpm add expo react react-native expo-status-bar
pnpm start            # Expo dev server (then press i / a)
pnpm ios              # iOS simulator
pnpm android          # Android emulator
```

Bundle ids: `dev.tronbrowser.app` (iOS + Android).

## Planned features (PRD §Mobile)

AI chat · sync · voice · push notifications · agent dashboard.

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
