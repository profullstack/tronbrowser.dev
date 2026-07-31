#!/usr/bin/env bash
# Collect the built APK + bundle into $DIST_DIR with TronBrowser asset names.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"
require_run package

mkdir -p "$DIST_DIR"
REPO_ROOT="$(cd "$CHROMIUM_DIR/../../.." && pwd)"   # apps/android-engine/chromium -> repo root
VERSION="$(node -p "require('$REPO_ROOT/package.json').version" 2>/dev/null || echo dev)"

# apks/ layout is produced by the *_apk / *_bundle targets under out/.../apks.
shopt -s nullglob
copied=0
for f in "$OUT_DIR"/apks/*.apk "$OUT_DIR"/apks/*.aab; do
  base="$(basename "$f")"; ext="${base##*.}"
  dest="$DIST_DIR/tronbrowser-android-${TB_TARGET_CPU}.${ext}"
  cp "$f" "$dest"
  echo "  + $dest"
  copied=$((copied + 1))
done
[[ "$copied" -gt 0 ]] || echo "  ! no .apk/.aab found in $OUT_DIR/apks — did build.sh run?"

echo "package: done -> $DIST_DIR (version=$VERSION)"
