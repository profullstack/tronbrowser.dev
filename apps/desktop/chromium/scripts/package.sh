#!/usr/bin/env bash
# Package the built browser into a distributable artifact per platform.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"
require_run package

DIST="$WORKDIR/dist"
mkdir -p "$DIST"

case "$(uname -s)" in
  Linux)
    tar -C "$OUT_DIR" -czf "$DIST/tronbrowser-linux-x64.tar.gz" .
    ;;
  Darwin)
    ( cd "$OUT_DIR" && zip -q -r "$DIST/tronbrowser-macos.zip" TronBrowser.app )
    ;;
  MINGW*|MSYS*|CYGWIN*)
    ( cd "$OUT_DIR" && zip -qr "$DIST/tronbrowser-win-x64.zip" . )
    ;;
esac

echo "package: done -> $DIST"
