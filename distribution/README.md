# Distribution channels

How TronBrowser reaches users. Modeled on pairux.com's multi-channel approach
(GitHub Releases as the source of truth; package managers layered on top).

| Channel | Status | Source |
| --- | --- | --- |
| `curl \| sh` installer | ✅ live | [`apps/web/public/install.sh`](../apps/web/public/install.sh) → GitHub Releases |
| GitHub Releases | ✅ live | [`.github/workflows/release.yml`](../.github/workflows/release.yml) (tag `v*`) |
| Homebrew (`brew install profullstack/tap/tronbrowser`) | 🟡 formula ready | [`homebrew/tronbrowser.rb`](homebrew/tronbrowser.rb) — needs a `profullstack/homebrew-tap` repo |
| Scoop (Windows) | ⬜ planned | manifest TBD |
| AUR (Arch) | ⬜ planned | PKGBUILD TBD |

## Release flow

1. Tag a version: `git tag v0.1.1 && git push origin v0.1.1`.
2. `release.yml` builds `tronbrowser-linux-x64.tar.gz` + `tronbrowser-macos.zip`
   and publishes a GitHub Release (create-then-`gh release upload`).
3. `submit-packages.yml` (manual dispatch) refreshes the downstream package
   managers (Homebrew tap, Scoop, AUR) with the new version + checksums.

The installer and Homebrew formula both consume the same release assets, so
there is one artifact per platform and no drift.
