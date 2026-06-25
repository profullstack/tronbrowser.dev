#!/usr/bin/env bash
# Assemble TronBrowser release archives (launcher shim + AI sidebar extension).
# Until the native fork binary is built, this packages the launcher; the asset
# names are stable so install.sh works unchanged when the real binary lands.
#
# Usage: build-release.sh <version> [outDir]
set -euo pipefail

VERSION="${1:?usage: build-release.sh <version> [outDir]}"
OUT="${2:-dist}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DESKTOP="$REPO_ROOT/apps/desktop"

stage="$(mktemp -d)/tronbrowser"
mkdir -p "$stage/extensions"
install -m 0755 "$DESKTOP/launcher/tronbrowser" "$stage/tronbrowser"
cp -R "$DESKTOP/extensions/ai-sidebar" "$stage/extensions/ai-sidebar"
cp "$REPO_ROOT/LICENSE" "$stage/LICENSE"
printf '%s\n' "$VERSION" > "$stage/VERSION"

case "$OUT" in /*) out_dir="$OUT" ;; *) out_dir="$REPO_ROOT/$OUT" ;; esac
mkdir -p "$out_dir"
abs_out="$(cd "$out_dir" && pwd)"

# The launcher is POSIX sh, so the same staging works for Linux and macOS.
( cd "$stage/.." && tar -czf "$abs_out/tronbrowser-linux-x64.tar.gz" tronbrowser )
( cd "$stage/.." && zip -qr "$abs_out/tronbrowser-macos.zip" tronbrowser )

echo "built:"
ls -lh "$abs_out"/tronbrowser-* | awk '{print "  "$9" ("$5")"}'
