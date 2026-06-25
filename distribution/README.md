# Distribution channels

How TronBrowser reaches users — the same channel set as pairux.com, kept in this
**single monorepo** (no per-package repos). GitHub Releases is the source of
truth; package managers consume the release assets.

## Channels

| Channel | Manifest | Artifact | Status |
| --- | --- | --- | --- |
| `curl \| sh` | [`apps/web/public/install.sh`](../apps/web/public/install.sh) | linux tar.gz / macos zip | ✅ live |
| GitHub Releases | [`release.yml`](../.github/workflows/release.yml) | all | ✅ live |
| Homebrew | [`homebrew/tronbrowser.rb`](homebrew/tronbrowser.rb) | linux tar.gz / macos zip | 🟡 formula ready (needs `profullstack/homebrew-tap`) |
| AUR | [`aur/PKGBUILD`](aur/PKGBUILD) | linux tar.gz | 🟡 ready (needs `AUR_SSH_KEY`) |
| Nix | [`nix/tronbrowser.nix`](nix/tronbrowser.nix) | linux tar.gz | 🟡 ready |
| Gentoo | [`gentoo/`](gentoo/) | linux tar.gz | 🟡 ebuild ready |
| apt (.deb) | [`packaging/nfpm.yaml`](../packaging/nfpm.yaml) | built by nfpm in CI | 🟡 built, needs an apt repo |
| rpm (.rpm) | [`packaging/nfpm.yaml`](../packaging/nfpm.yaml) | built by nfpm in CI | 🟡 built, needs a yum repo |
| Scoop | [`scoop/tronbrowser.json`](scoop/tronbrowser.json) | win zip | ⬜ needs Windows artifact hash |
| winget | [`winget/`](winget/) | win zip | ⬜ needs Windows artifact + winget-pkgs PR |
| Chocolatey | [`chocolatey/`](chocolatey/) | win zip | ⬜ needs Windows artifact + `CHOCOLATEY_API_KEY` |

## CI/CD (per platform, one repo)

[`release.yml`](../.github/workflows/release.yml) runs on a `v*` tag:

1. **create-release** — open a draft GitHub Release.
2. **build** (matrix: `ubuntu-latest` → linux tar.gz + .deb + .rpm,
   `macos-latest` → macos zip, `windows-latest` → win zip) — each runner builds
   its platform's artifacts and `gh release upload`s them to the draft.
3. **publish** — un-draft once all platforms uploaded.

[`submit-packages.yml`](../.github/workflows/submit-packages.yml) runs on release
publish (or manual dispatch with `version` / `dry_run` / `package_managers`). It
runs [`scripts/submit-packages.mjs`](../scripts/submit-packages.mjs) to refresh
each manifest's version + sha256 from the release assets, then submits per
channel — gated on that channel's secret, dry-run by default.

## Secrets needed to actually submit

`AUR_SSH_KEY`, `GPG_PRIVATE_KEY`/`GPG_PASSPHRASE`, `CHOCOLATEY_API_KEY`,
`PKG_SUBMIT_TOKEN` (for tap/bucket/winget-pkgs PRs). Until set, channels dry-run.

## Bump a release

```bash
pnpm version:set 0.1.1            # sync all app/package versions
git tag v0.1.1 && git push origin v0.1.1
# release.yml builds + publishes; submit-packages.yml refreshes manifests
```
