#!/usr/bin/env bash
# Generate GN args for the host platform and build TronBrowser with ninja.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"
require_run build

export PATH="$DEPOT_TOOLS_DIR:$PATH"

case "$(uname -s)" in
  Linux)  PLATFORM_GNI="$CONFIG_DIR/gn-args/linux.gni" ;;
  Darwin) PLATFORM_GNI="$CONFIG_DIR/gn-args/macos.gni" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM_GNI="$CONFIG_DIR/gn-args/windows.gni" ;;
  *) echo "unsupported host: $(uname -s)"; exit 1 ;;
esac

mkdir -p "$OUT_DIR"
# Concatenate common + platform args into the GN args file.
cat "$CONFIG_DIR/gn-args/common.gni" "$PLATFORM_GNI" > "$OUT_DIR/args.gn"

( cd "$SRC_DIR" && gn gen "$OUT_DIR" )
( cd "$SRC_DIR" && autoninja -C "$OUT_DIR" chrome )

echo "build: done -> $OUT_DIR"
