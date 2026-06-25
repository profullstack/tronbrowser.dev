#!/usr/bin/env bash
# Assemble TronBrowser release archives (launcher shim + AI sidebar extension)
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

stage() { # dest dir
  local s="$1"
  mkdir -p "$s/extensions"
  install -m 0755 "$DESKTOP/launcher/tronbrowser" "$s/tronbrowser"
  cp "$DESKTOP/launcher/tronbrowser.cmd" "$s/tronbrowser.cmd"
  cp -R "$DESKTOP/extensions/ai-sidebar" "$s/extensions/ai-sidebar"
  cp "$REPO_ROOT/LICENSE" "$s/LICENSE"
  cp "$REPO_ROOT/apps/web/public/favicon.svg" "$s/tronbrowser.svg"
  printf '%s\n' "$VERSION" > "$s/VERSION"

  # Bundle chromium-web-store so Chrome Web Store installs work on Ungoogled
  # Chromium (which disables them by default). Preserves extension compatibility.
  # Non-fatal: a download hiccup must not fail the release. Use the stable
  # latest/download URL (no GitHub API → no rate limit).
  local crx; crx="$(mktemp)"
  local url="https://github.com/NeverDecaf/chromium-web-store/releases/latest/download/Chromium.Web.Store.crx"
  if curl -fsSL "$url" -o "$crx" 2>/dev/null; then
    mkdir -p "$s/extensions/chromium-web-store"
    unzip -q -o "$crx" -d "$s/extensions/chromium-web-store" 2>/dev/null || true
    [ -f "$s/extensions/chromium-web-store/manifest.json" ] && echo "  + bundled chromium-web-store" \
      || rm -rf "$s/extensions/chromium-web-store"
  else
    echo "  ! chromium-web-store download skipped (non-fatal)"
  fi
  rm -f "$crx"
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

case "$PLATFORM" in
  linux|macos|windows) build_archive "$PLATFORM" ;;
  all) build_archive linux; build_archive macos; build_archive windows ;;
  *) echo "unknown platform: $PLATFORM (linux|macos|windows|all)" >&2; exit 1 ;;
esac

echo "built ($PLATFORM):"
ls -lh "$OUT"/tronbrowser-* 2>/dev/null | awk '{print "  "$9" ("$5")"}'
