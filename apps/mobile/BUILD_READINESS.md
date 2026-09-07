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

## GitHub Actions preview APK

Every mobile pull request and push to `main` also generates the Android native
project and runs Gradle on a GitHub-hosted runner. Download the
`tronbrowser-android-preview-*` artifact from the `Mobile` workflow, extract it,
then install the APK on a connected Android device:

```bash
adb install -r app-release.apk
```

If another build of the app is installed with a different signing key, uninstall
that build before installing this preview APK.

This standalone build embeds its JavaScript bundle and is signed with the
generated debug keystore for sideload testing. It is not store-signed. The job
does not use Expo EAS credits, publish an app, or commit the generated `android/`
directory.

## Android runtime smoke checklist

Run on one Android 15+ device or emulator with the sideloaded preview APK.
These behaviors are covered by component tests with a mocked native boundary;
this checklist is the real-device gate that the mocks cannot replace.

1. **Search, no account** — type `privacy first browser` in the address bar and
   submit: a DuckDuckGo results page loads (no Kagi login wall).
2. **Two-page history** — from the results page open any result, then tap the
   in-app `‹` button: the results page returns.
3. **Tab-state survival** — load a page, scroll partway, switch to Chat, type a
   draft (don't send), visit Agents and Settings, return to Browse: the same
   page and scroll position are still there; return to Chat: the draft is
   still there.
4. **System Back** — with two pages of history and Browse active, the system
   back gesture/button goes to the previous page; on the first page it leaves
   the app. With Chat active it leaves the app immediately, even when the
   hidden Browse tab still has history.
5. **System-bar insets** — the URL toolbar sits fully below the status bar and
   the tab bar fully above the gesture/navigation bar, in portrait, with no
   content underlapping either bar.
6. **Popup links** — open a `target="_blank"` link (e.g. a result on a site
   that opens externally): it loads visibly in the same tab and Back returns
   to the referring page. A `javascript:` or `data:` popup does nothing.
7. **Cookie wording** — Settings → Privacy shows "Blocked in browser tab" on
   Android (an iOS build must show the WebKit wording instead).

Record the device model, Android version, and each step's result honestly —
an APK that has not passed this list is not release-ready.

## EAS preview build

The app is linked to the `profullstack/tronbrowserdev` EAS project. Cloud builds
require an Expo access token from the `profullstack` account. The account owner
should add that token directly to the GitHub repository as the `EXPO_TOKEN`
Actions secret; the token should not be shared in chat or committed to git.

After the secret is present, run the `Mobile` workflow manually with:

- platform: `android`
- profile: `preview`
- submit: `false`

The workflow waits for EAS to finish, so a successful Actions job means the
remote build completed rather than merely entered the queue. Its EAS build URL
is the handoff artifact for review. Store submission is only available with the
`production` build profile and still requires the corresponding Apple or Google
developer account and signing setup.
