#!/usr/bin/env bash
# Build a universal-Linux AppImage from the linux release tarball.
# Usage: distribution/appimage/build.sh <version>  (expects dist/tronbrowser-linux-x64.tar.gz)
set -euo pipefail

VERSION="${1:?usage: build.sh <version>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARBALL="$ROOT/dist/tronbrowser-linux-x64.tar.gz"
[ -f "$TARBALL" ] || { echo "missing $TARBALL — run build-release.sh linux first" >&2; exit 1; }

appdir="$(mktemp -d)/TronBrowser.AppDir"
mkdir -p "$appdir/usr/lib" "$appdir/usr/bin"
tar -xzf "$TARBALL" -C "$appdir/usr/lib"            # -> usr/lib/tronbrowser

# AppRun -> the launcher.
cat > "$appdir/AppRun" <<'EOF'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/lib/tronbrowser/tronbrowser" "$@"
EOF
chmod +x "$appdir/AppRun"

cp "$HERE/tronbrowser.desktop" "$appdir/tronbrowser.desktop"
if command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w 256 -h 256 "$ROOT/apps/web/public/favicon.svg" -o "$appdir/tronbrowser.png"
else
  cp "$ROOT/apps/web/public/favicon.svg" "$appdir/tronbrowser.svg"
fi

tool=/tmp/appimagetool
[ -x "$tool" ] || curl -sSfL "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage" -o "$tool"
chmod +x "$tool"
ARCH=x86_64 "$tool" --appimage-extract-and-run "$appdir" "$ROOT/dist/TronBrowser-x86_64.AppImage"
echo "built: $ROOT/dist/TronBrowser-x86_64.AppImage"
