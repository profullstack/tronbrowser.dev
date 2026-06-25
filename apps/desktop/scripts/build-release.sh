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

stage() { # dest dir
  local s="$1"
  mkdir -p "$s/extensions"
  install -m 0755 "$DESKTOP/launcher/tronbrowser" "$s/tronbrowser"
  cp "$DESKTOP/launcher/tronbrowser.cmd" "$s/tronbrowser.cmd"
  # -L dereferences the branding symlinks (icons/logo.svg -> repo-root logo.svg)
  # so the package contains real files, not dangling links.
  cp -RL "$DESKTOP/extensions/ai-sidebar" "$s/extensions/ai-sidebar"
  cp "$REPO_ROOT/LICENSE" "$s/LICENSE"
  # Branding from the repo-root single source of truth. The desktop/app icon uses
  # the EMBLEM-only mark (mark.svg) — the full lockup (favicon.svg, with wordmark)
  # is only for big logo displays, not tiny app icons.
  cp -L "$REPO_ROOT/mark.svg" "$s/tronbrowser.svg"
  cp -L "$REPO_ROOT/favicon.svg" "$s/favicon.svg"
  cp -L "$REPO_ROOT/logo.svg" "$s/logo.svg"
  cp -L "$REPO_ROOT/banner.png" "$s/banner.png"
  # PNG app icon (emblem) for desktops that render SVG icons poorly (KDE).
  cp -L "$REPO_ROOT/apps/web/public/icons/icon-512x512.png" "$s/tronbrowser.png" 2>/dev/null || true
  printf '%s\n' "$VERSION" > "$s/VERSION"

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

case "$PLATFORM" in
  linux|macos|windows) build_archive "$PLATFORM" ;;
  all) build_archive linux; build_archive macos; build_archive windows ;;
  *) echo "unknown platform: $PLATFORM (linux|macos|windows|all)" >&2; exit 1 ;;
esac

echo "built ($PLATFORM):"
ls -lh "$OUT"/tronbrowser-* 2>/dev/null | awk '{print "  "$9" ("$5")"}'
