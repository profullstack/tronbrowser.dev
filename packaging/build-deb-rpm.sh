#!/usr/bin/env bash
# Build .deb and .rpm from the linux release tarball using nfpm.
# Usage: build-deb-rpm.sh <version>   (expects dist/tronbrowser-linux-x64.tar.gz)
set -euo pipefail

VERSION="${1:?usage: build-deb-rpm.sh <version>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARBALL="$ROOT/dist/tronbrowser-linux-x64.tar.gz"
[ -f "$TARBALL" ] || { echo "missing $TARBALL — run build-release.sh linux first" >&2; exit 1; }

command -v nfpm >/dev/null 2>&1 || { echo "nfpm not installed (https://nfpm.goreleaser.com)" >&2; exit 1; }

work="$(mktemp -d)"
tar -xzf "$TARBALL" -C "$work"            # -> $work/tronbrowser

TB_VERSION="${VERSION#v}"
TB_ROOT="$work/tronbrowser"

# Render the config (nfpm doesn't reliably expand env in contents.src globs).
rendered="$work/nfpm.yaml"
sed -e "s|\${TB_VERSION}|${TB_VERSION}|g" -e "s|\${TB_ROOT}|${TB_ROOT}|g" \
  "$ROOT/packaging/nfpm.yaml" > "$rendered"

nfpm package -f "$rendered" -p deb -t "$ROOT/dist"
nfpm package -f "$rendered" -p rpm -t "$ROOT/dist"

rm -rf "$work"
echo "built deb + rpm:"
ls -lh "$ROOT/dist"/*.deb "$ROOT/dist"/*.rpm 2>/dev/null | awk '{print "  "$9" ("$5")"}'
