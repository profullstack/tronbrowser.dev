#!/usr/bin/env bash
# Assemble the TronBrowser Ubuntu Touch click package from the linux release
# tarball (noarch launcher tree). Usage:
#   distribution/ubuntu-touch/build.sh <version> [arch]
#   arch: arm64 (default) | armhf | amd64   (expects dist/tronbrowser-linux-x64.tar.gz)
#
# Produces install/ (the click tree) and, if a click builder is available, a
# .click under dist/. See README.md for the Libertine/confinement story.
set -euo pipefail

VERSION="${1:?usage: build.sh <version> [arch]}"
ARCH="${2:-arm64}"
TB_VERSION="${VERSION#v}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARBALL="$ROOT/dist/tronbrowser-linux-x64.tar.gz"
[ -f "$TARBALL" ] || { echo "missing $TARBALL — run build-release.sh linux first" >&2; exit 1; }

INSTALL="$HERE/install"
rm -rf "$INSTALL"; mkdir -p "$INSTALL/assets"

# Noarch launcher tree (the same one the .deb/tarball ship).
tar -xzf "$TARBALL" -C "$INSTALL"          # -> $INSTALL/tronbrowser
install -m 0755 "$HERE/tronbrowser-ut" "$INSTALL/tronbrowser-ut"
cp "$HERE/tronbrowser.apparmor" "$INSTALL/tronbrowser.apparmor"
cp "$HERE/tronbrowser.desktop" "$INSTALL/tronbrowser.desktop"
cp "$INSTALL/tronbrowser/tronbrowser.png" "$INSTALL/assets/tronbrowser.png"

# Render manifest (version + arch).
sed -e "s|\"version\": \"[^\"]*\"|\"version\": \"${TB_VERSION}\"|" \
    -e "s|@CLICK_ARCH@|${ARCH}|" \
  "$HERE/manifest.json" > "$INSTALL/manifest.json"

echo "staged click tree at $INSTALL (arch=$ARCH, version=$TB_VERSION)"

# Validate the JSON we just produced.
for j in manifest.json tronbrowser.apparmor; do
  python3 -c "import json,sys; json.load(open('$INSTALL/$j'))" \
    && echo "  ok: $j"
done

# Build the .click if a builder is available; otherwise leave the staged tree.
if command -v clickable >/dev/null 2>&1; then
  ( cd "$HERE" && clickable build --arch "$ARCH" )
elif command -v click >/dev/null 2>&1; then
  mkdir -p "$ROOT/dist"
  click build "$INSTALL" --output "$ROOT/dist"
  ls -lh "$ROOT/dist"/*.click 2>/dev/null | awk '{print "  built "$9" ("$5")"}'
else
  echo "note: no 'clickable' or 'click' found — staged tree only."
  echo "      install Clickable (https://clickable-ut.dev) then: clickable build --arch $ARCH"
fi
