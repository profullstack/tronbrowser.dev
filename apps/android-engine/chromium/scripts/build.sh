#!/usr/bin/env bash
# Generate Android GN args and build the TronBrowser APK + bundle with ninja.
# Build host must be Linux (Android Chromium builds don't run on macOS/Windows).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"
require_run build

[[ "$(uname -s)" == "Linux" ]] || { echo "Android Chromium builds require a Linux host"; exit 1; }
export PATH="$DEPOT_TOOLS_DIR:$PATH"

mkdir -p "$OUT_DIR"
# common + android args, with the target CPU substituted into android.gni.
{
  cat "$CONFIG_DIR/gn-args/common.gni"
  sed "s|\${TB_TARGET_CPU}|${TB_TARGET_CPU}|g" "$CONFIG_DIR/gn-args/android.gni"
} > "$OUT_DIR/args.gn"

echo "==> gn gen ($TB_TARGET_CPU)"
( cd "$SRC_DIR" && gn gen "$OUT_DIR" )

# Build each configured ninja target (chrome_public_apk, chrome_public_bundle).
mapfile -t TARGETS < <(node -e "require('$CONFIG_DIR/version.json').ninjaTargets.forEach(t=>console.log(t))")
for t in "${TARGETS[@]}"; do
  echo "==> autoninja $t"
  ( cd "$SRC_DIR" && autoninja -C "$OUT_DIR" "$t" )
done

echo "build: done -> $OUT_DIR (cpu=$TB_TARGET_CPU)"
