# Distribution channels

Every channel lives **here** in the one monorepo (no per-package repos), modeled
on pairux.com. GitHub Releases is the source of truth; each channel consumes the
release assets. Goal: every major OS + open-source platform.

## Platform matrix

| OS / family | Channel | Manifest | Status |
| --- | --- | --- | --- |
| **All** | `curl \| sh` | [`apps/web/public/install.sh`](../apps/web/public/install.sh) | ✅ live |
| **All** | GitHub Releases | [`release.yml`](../.github/workflows/release.yml) | ✅ live |
| macOS / Linux | Homebrew | [`homebrew/`](homebrew/) | 🟡 formula ready (needs tap repo) |
| Windows | Scoop | [`scoop/`](scoop/) | ⬜ needs win zip hash |
| Windows | winget | [`winget/`](winget/) | ⬜ needs winget-pkgs PR |
| Windows | Chocolatey | [`chocolatey/`](chocolatey/) | ⬜ needs `CHOCOLATEY_API_KEY` |
| Debian / Ubuntu | apt (.deb) | [`deb-rpm/`](deb-rpm/) (nfpm) | ✅ built in CI |
| RedHat / Fedora / SUSE | rpm (.rpm) | [`deb-rpm/`](deb-rpm/) (nfpm) | ✅ built in CI |
| Arch | AUR | [`aur/PKGBUILD`](aur/PKGBUILD) | 🟡 needs `AUR_SSH_KEY` |
| Gentoo | ebuild | [`gentoo/`](gentoo/) | 🟡 overlay ready |
| NixOS | Nix | [`nix/tronbrowser.nix`](nix/tronbrowser.nix) | 🟡 ready |
| Ubuntu / universal | Snap | [`snap/snapcraft.yaml`](snap/snapcraft.yaml) | 🟡 classic snap (Snap Store login) |
| Universal Linux | Flatpak | [`flatpak/`](flatpak/) | 🟡 manifest ready (Flathub PR) |
| Universal Linux | AppImage | [`appimage/`](appimage/) | ✅ built in CI |
| FreeBSD | port | [`freebsd/`](freebsd/) | 🟡 port ready |
| Librem 5 / PinePhone / Ubuntu Touch | `curl \| sh` (arm64) | install.sh | ✅ noarch launcher |
| iOS / Android | Expo / EAS | [`apps/mobile`](../apps/mobile) | 🚧 Phase 2 |

## CI/CD (per platform, one repo)

[`release.yml`](../.github/workflows/release.yml) on a `v*` tag:

1. **create-release** — draft GitHub Release.
2. **build** matrix — `ubuntu` (linux tar.gz + .deb + .rpm + AppImage),
   `macos` (zip), `windows` (win zip); each uploads via `gh release upload`.
3. **publish** — un-draft.

[`submit-packages.yml`](../.github/workflows/submit-packages.yml) on release publish
(or dispatch) runs [`scripts/submit-packages.mjs`](../scripts/submit-packages.mjs)
to refresh each manifest's version + sha256 from the release assets and submit per
channel — gated on that channel's secret, dry-run by default.

## Build a single channel locally

```bash
bash apps/desktop/scripts/build-release.sh v0.1.1 linux   # tar.gz
bash distribution/deb-rpm/build.sh v0.1.1                  # .deb + .rpm (needs nfpm)
bash distribution/appimage/build.sh v0.1.1                # .AppImage
node scripts/submit-packages.mjs -v 0.1.1 -p all --dry-run
```

## Secrets to actually publish

`AUR_SSH_KEY`, `GPG_PRIVATE_KEY`/`GPG_PASSPHRASE`, `CHOCOLATEY_API_KEY`,
`SNAPCRAFT_STORE_CREDENTIALS`, `PKG_SUBMIT_TOKEN` (tap/bucket/winget-pkgs/Flathub
PRs). Until set, channels dry-run.
