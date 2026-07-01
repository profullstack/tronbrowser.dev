# TronBrowser on Ubuntu Touch (click)

Packages the noarch TronBrowser launcher as an Ubuntu Touch **click** app so it
appears in the app grid and opens `http(s)` links.

## The honest constraint (read this first)

Ubuntu Touch **confines** click apps under AppArmor and ships the Morph/Oxide
web engine — **not** a desktop Chromium. Running the *real* Ungoogled Chromium
(the whole point of TronBrowser, incl. `--tor`) therefore needs a **Libertine**
container, where a normal `chromium` is installed and driven by the bundled
`tron` shim. This is the same full-parity engine as the desktop build — it just
runs inside Libertine rather than under strict confinement.

Because Chromium-in-Libertine needs an `unconfined` AppArmor profile
(`tronbrowser.apparmor`), this click is intended for **sideloading / the
OpenStore "unconfined" track**, not the confined default. See
[`../../docs/mobile-architecture.md`](../../docs/mobile-architecture.md) (Track 2).

## One-time device setup (Libertine)

In the Terminal app or over `adb shell`:

```bash
libertine-container-manager create -i tron -n TronBrowser -t chroot
libertine-container-manager install-package -i tron -p chromium
```

The wrapper (`tronbrowser-ut`) then runs `libertine-launch -i tron tron <url>`.
Override the container id with `TRONBROWSER_LIBERTINE_ID`.

## Build the click

```bash
# 1) produce the noarch tarball (once)
bash apps/desktop/scripts/build-release.sh v3.7.2 linux
# 2) stage + build the click (arm64 default; also armhf/amd64)
bash distribution/ubuntu-touch/build.sh v3.7.2 arm64
```

`build.sh` stages `install/` and, if [Clickable](https://clickable-ut.dev) (or
the raw `click` tool) is installed, emits a `.click` into `dist/`. Without a
builder it leaves the validated `install/` tree.

## Install on device

```bash
clickable install --arch arm64        # from this dir, device in dev mode
# or push the .click and: pkcon install-local --allow-untrusted dist/*.click
```

## Files

- `manifest.json` — click manifest (`@CLICK_ARCH@` + version filled by build.sh).
- `tronbrowser.apparmor` — `unconfined` (required for Chromium-in-Libertine).
- `tronbrowser.desktop` — app-grid entry (`Exec=tronbrowser-ut %u`).
- `tronbrowser-ut` — entry wrapper: `libertine-launch` → bundled `tron`.
- `clickable.yaml` — Clickable `pure` builder config.
