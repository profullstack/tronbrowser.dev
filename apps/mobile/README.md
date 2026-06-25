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

Builds/submission will go through EAS (`eas build` / `eas submit`); a CI
workflow lands when Phase 2 starts.
