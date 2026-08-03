# Mobile build readiness

This checklist covers the Expo companion in `apps/mobile`. It does not cover
the native Chromium build in `apps/android-engine`.

## Local toolchain

- Node.js 24 (see the repository `.nvmrc` and root `engines` field)
- pnpm 9.12.0 via Corepack

Run these local release-readiness checks from the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @tronbrowser/mobile typecheck
pnpm --filter @tronbrowser/mobile lint
pnpm --filter @tronbrowser/mobile test
pnpm --filter @tronbrowser/mobile export
cd apps/mobile && pnpm dlx expo-doctor
```

The mobile package intentionally stays on the workspace TypeScript 5.x line.
Expo Doctor currently recommends TypeScript 6 for SDK 57, but changing the
compiler major is a workspace-wide migration rather than a mobile-only update.
The exception is declared in `package.json`; typecheck, tests, lint, and both
platform bundles remain the CI acceptance checks. Expo Doctor is a
network-backed local diagnostic and is not run in CI.

## EAS preview build

The app is linked to the `profullstack/tronbrowserdev` EAS project. Cloud builds
require an Expo access token from the `profullstack` account. The account owner
should add that token directly to the GitHub repository as the `EXPO_TOKEN`
Actions secret; the token should not be shared in chat or committed to git.

After the secret is present, run the `Mobile` workflow manually with:

- platform: `android`
- profile: `preview`
- submit: `false`

The workflow starts an asynchronous EAS build. Its EAS build URL is the handoff
artifact for review. Store submission remains a separate production step and
requires the corresponding Apple or Google developer account and signing setup.
