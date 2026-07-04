#!/usr/bin/env bash
# Assemble TronBrowser release archives (launcher shim + AI sidebar + uBlock
# Origin + chromium-web-store extensions)
# for a given platform. Until the native fork binary is built, this packages the
# launcher; asset names are stable so install.sh / package managers are unchanged.
#
# Usage: build-release.sh <version> [linux|macos|windows|all]
set -euo pipefail

VERSION="${1:?usage: build-release.sh <version> [platform]}"
PLATFORM="${2:-all}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DESKTOP="$REPO_ROOT/apps/desktop"
OUT="$REPO_ROOT/dist"
mkdir -p "$OUT"

# Fetch uBlock Origin ONCE (the per-platform stage() copies from here). Full
# uBlock Origin is MV2 — Ungoogled Chromium keeps MV2 support, so we ship the
# real thing (not uBO Lite). The release asset name carries the version, so we
# resolve the latest .chromium.zip via the GitHub API. Entirely non-fatal.
UBO_SRC=""
fetch_ublock() {
  command -v python3 >/dev/null 2>&1 || { echo "  ! uBlock skipped (no python3)"; return; }
  local url
  url="$(curl -fsSL https://api.github.com/repos/gorhill/uBlock/releases/latest 2>/dev/null \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);print(next((a["browser_download_url"] for a in d["assets"] if a["name"].endswith(".chromium.zip")),""))' 2>/dev/null)" || true
  [ -n "$url" ] || { echo "  ! uBlock resolve skipped (non-fatal)"; return; }
  local z d m; z="$(mktemp)"; d="$(mktemp -d)"
  if curl -fsSL "$url" -o "$z" 2>/dev/null && unzip -q -o "$z" -d "$d" 2>/dev/null; then
    m="$(find "$d" -maxdepth 2 -name manifest.json | head -1)"
    if [ -n "$m" ]; then UBO_SRC="$(dirname "$m")"; echo "  + fetched uBlock Origin ($url)"; fi
  fi
  rm -f "$z"  # keep $d (UBO_SRC lives inside) until the script exits
}

# Fetch MarkSyncr ONCE from the Chrome Web Store (latest published CRX). Open
# source (github.com/profullstack/marksyncr.com), MV3 bookmark sync. Non-fatal.
MKS_ID="hjcjjcpialiakkalcgadnfnoomdaegjg"
MKS_SRC=""
fetch_marksyncr() {
  local url="https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&prodversion=120.0.0.0&x=id%3D${MKS_ID}%26installsource%3Dondemand%26uc"
  local z d m; z="$(mktemp)"; d="$(mktemp -d)"
  if curl -fsSL -A "Mozilla/5.0 Chrome/120.0.0.0" "$url" -o "$z" 2>/dev/null; then
    # CRX files have a header before the zip → unzip prints a warning and exits
    # 1 even though it extracts fine; don't gate on its exit code.
    unzip -q -o "$z" -d "$d" 2>/dev/null || true
    m="$(find "$d" -maxdepth 2 -name manifest.json | head -1)"
    if [ -n "$m" ]; then MKS_SRC="$(dirname "$m")"; echo "  + fetched MarkSyncr (CWS $MKS_ID)"; fi
  fi
  rm -f "$z"
  [ -n "$MKS_SRC" ] || echo "  ! MarkSyncr fetch skipped (non-fatal)"
}

# The Node automation runtime for `tron snapshot|click|fill|extract|...` (M3.2/3)
# and the `@tronbrowser/sdk` used by `tron run` (M3.4). Both packages' source has
# no runtime deps, so their compiled dist trees are self-contained; ship each with
# a {"type":"module"} marker and the shell dispatcher / tron-run.mjs run them via
# node. Best-effort like the extension fetches — a build host without node/pnpm
# simply omits them (the CLI then reports "run tron upgrade").
stage_automation() { # dest dir
  local s="$1"
  command -v node >/dev/null 2>&1 && command -v pnpm >/dev/null 2>&1 || {
    echo "  ! automation runtime skipped (needs node + pnpm)"; return; }
  if ( cd "$REPO_ROOT" && pnpm --filter @tronbrowser/browser-core --filter @tronbrowser/sdk build >/dev/null 2>&1 ); then
    rm -rf "$s/automate" "$s/sdk"
    cp -R "$REPO_ROOT/packages/browser-core/dist" "$s/automate"
    printf '{\n  "type": "module"\n}\n' > "$s/automate/package.json"
    cp -R "$REPO_ROOT/packages/sdk/dist" "$s/sdk"
    printf '{\n  "type": "module"\n}\n' > "$s/sdk/package.json"
    echo "  + bundled automation runtime + SDK (tron snapshot/extract/run)"
  else
    echo "  ! automation runtime skipped (browser-core/sdk build failed)"
  fi
}

stage() { # dest dir
  local s="$1"
  mkdir -p "$s/extensions"
  install -m 0755 "$DESKTOP/launcher/tronbrowser" "$s/tronbrowser"
  cp "$DESKTOP/launcher/tronbrowser.cmd" "$s/tronbrowser.cmd"
  # On-demand Tor control helper for the in-browser 🧅 Tor toggle (the launcher
  # starts it; it starts Tor only when the toggle asks).
  install -m 0755 "$DESKTOP/launcher/tron-tor-helper" "$s/tron-tor-helper"
  # Managed-session engine for `tron browser …` / `tron open` (PRD M3.1). Sits
  # next to the shim; the `tron` dispatcher resolves it relative to $CURRENT.
  install -m 0755 "$DESKTOP/launcher/tron-session" "$s/tron-session"
  # `tron run` launcher + ESM resolver hook (PRD M3.4).
  install -m 0644 "$DESKTOP/launcher/tron-run.mjs" "$s/tron-run.mjs"
  install -m 0644 "$DESKTOP/launcher/tron-run-hooks.mjs" "$s/tron-run-hooks.mjs"
  stage_automation "$s"
  # -L dereferences the branding symlinks (icons/logo.svg -> repo-root logo.svg)
  # so the package contains real files, not dangling links.
  cp -RL "$DESKTOP/extensions/ai-sidebar" "$s/extensions/ai-sidebar"
  cp "$REPO_ROOT/LICENSE" "$s/LICENSE"
  # Branding from the repo-root single source of truth. The desktop/app icon uses
  # the emblem on the dark tile (hero.svg) — favicon.svg is the transparent emblem
  # and logo.svg is the full lockup, only for big displays, not tiny app icons.
  cp -L "$REPO_ROOT/hero.svg" "$s/tronbrowser.svg"
  cp -L "$REPO_ROOT/favicon.svg" "$s/favicon.svg"
  cp -L "$REPO_ROOT/logo.svg" "$s/logo.svg"
  cp -L "$REPO_ROOT/banner.png" "$s/banner.png"
  # PNG app icon (emblem) for desktops that render SVG icons poorly (KDE).
  cp -L "$REPO_ROOT/apps/web/public/icons/icon-512x512.png" "$s/tronbrowser.png" 2>/dev/null || true
  printf '%s\n' "$VERSION" > "$s/VERSION"

  # Freedesktop .desktop entry so TronBrowser appears in app grids/menus —
  # notably the Linux-phone shells (Phosh on Librem 5, Phosh/Plasma Mobile on
  # PinePhone). The .deb installs this to /usr/share/applications; harmless in
  # the tarball. StartupWMClass matches the isolated-profile Chromium window.
  cat > "$s/tronbrowser.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=TronBrowser
GenericName=Web Browser
Comment=Privacy-first, AI-native browser (Ungoogled Chromium)
Exec=tron %U
TryExec=tron
Icon=tronbrowser
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
Keywords=web;browser;privacy;tor;ai;
StartupNotify=true
StartupWMClass=tronbrowser
X-Purism-FormFactor=Workstation;Mobile;
DESKTOP

  # NOTE: we no longer bundle NeverDecaf's chromium-web-store. Its manifest's
  # web_accessible_resources is rejected by some Chromium builds (macOS), which
  # aborts startup when loaded unpacked via --load-extension. Chrome Web Store
  # installs are instead handled by the AI sidebar's install-helper.js content
  # script (adds a working "Add to TronBrowser" button → CRX install prompt).

  # Default ad/tracker blocker: uBlock Origin (fetched once into $UBO_SRC).
  if [ -n "$UBO_SRC" ] && [ -d "$UBO_SRC" ]; then
    mkdir -p "$s/extensions/ublock-origin"
    cp -R "$UBO_SRC/." "$s/extensions/ublock-origin/"
  fi
  # Bundled bookmark sync: MarkSyncr (fetched once into $MKS_SRC).
  if [ -n "$MKS_SRC" ] && [ -d "$MKS_SRC" ]; then
    mkdir -p "$s/extensions/marksyncr"
    cp -R "$MKS_SRC/." "$s/extensions/marksyncr/"
  fi
}

build_archive() { # ext-type
  local t; t="$(mktemp -d)"
  stage "$t/tronbrowser"
  case "$1" in
    linux)   ( cd "$t" && tar -czf "$OUT/tronbrowser-linux-x64.tar.gz" tronbrowser ) ;;
    macos)   ( cd "$t" && zip -qr "$OUT/tronbrowser-macos.zip" tronbrowser ) ;;
    windows) ( cd "$t" && zip -qr "$OUT/tronbrowser-win-x64.zip" tronbrowser ) ;;
  esac
  rm -rf "$t"
}

fetch_ublock
fetch_marksyncr

case "$PLATFORM" in
  linux|macos|windows) build_archive "$PLATFORM" ;;
  all) build_archive linux; build_archive macos; build_archive windows ;;
  *) echo "unknown platform: $PLATFORM (linux|macos|windows|all)" >&2; exit 1 ;;
esac

echo "built ($PLATFORM):"
ls -lh "$OUT"/tronbrowser-* 2>/dev/null | awk '{print "  "$9" ("$5")"}'
