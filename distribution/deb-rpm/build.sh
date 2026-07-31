#!/usr/bin/env bash
# Build .deb and .rpm from the linux release tarball using nfpm.
#
# Usage: distribution/deb-rpm/build.sh <version> [arch ...]
#   arch defaults to "amd64 arm64" (arm64 is what Linux phones install).
#   Valid archs: amd64 arm64  (expects dist/tronbrowser-linux-x64.tar.gz)
#
# The staged tree is noarch, so every arch is packaged from the same tarball;
# only the package's Architecture field (and deb/rpm arch tag) changes.
set -euo pipefail

VERSION="${1:?usage: build.sh <version> [arch ...]}"; shift || true
ARCHES=("$@"); [ ${#ARCHES[@]} -gt 0 ] || ARCHES=(amd64 arm64)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARBALL="$ROOT/dist/tronbrowser-linux-x64.tar.gz"
[ -f "$TARBALL" ] || { echo "missing $TARBALL — run build-release.sh linux first" >&2; exit 1; }
command -v nfpm >/dev/null 2>&1 || { echo "nfpm not installed (https://nfpm.goreleaser.com)" >&2; exit 1; }

work="$(mktemp -d)"
tar -xzf "$TARBALL" -C "$work"            # -> $work/tronbrowser

TB_VERSION="${VERSION#v}"
TB_ROOT="$work/tronbrowser"

for TB_ARCH in "${ARCHES[@]}"; do
  rendered="$work/nfpm-${TB_ARCH}.yaml"
  sed -e "s|\${TB_VERSION}|${TB_VERSION}|g" \
      -e "s|\${TB_ROOT}|${TB_ROOT}|g" \
      -e "s|\${TB_ARCH}|${TB_ARCH}|g" \
    "$HERE/nfpm.yaml" > "$rendered"
  nfpm package -f "$rendered" -p deb -t "$ROOT/dist"
  nfpm package -f "$rendered" -p rpm -t "$ROOT/dist"
done

rm -rf "$work"
echo "built deb + rpm (${ARCHES[*]}):"
ls -lh "$ROOT/dist"/*.deb "$ROOT/dist"/*.rpm 2>/dev/null | awk '{print "  "$9" ("$5")"}'
