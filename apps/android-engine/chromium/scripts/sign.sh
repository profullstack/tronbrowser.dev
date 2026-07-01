#!/usr/bin/env bash
# Sign the packaged APK(s) with the TronBrowser release keystore.
#
# Credentials come from the environment (CI secrets), never the repo:
#   TB_KEYSTORE       path to the .jks/.keystore
#   TB_KEYSTORE_PASS  keystore password
#   TB_KEY_ALIAS      signing key alias
#   TB_KEY_PASS       key password (defaults to TB_KEYSTORE_PASS)
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"
require_run sign

: "${TB_KEYSTORE:?set TB_KEYSTORE}"
: "${TB_KEYSTORE_PASS:?set TB_KEYSTORE_PASS}"
: "${TB_KEY_ALIAS:?set TB_KEY_ALIAS}"
TB_KEY_PASS="${TB_KEY_PASS:-$TB_KEYSTORE_PASS}"

APKSIGNER="$(command -v apksigner || echo "$SRC_DIR/third_party/android_sdk/public/build-tools"/*/apksigner)"
[[ -x "$APKSIGNER" ]] || { echo "apksigner not found (Android SDK build-tools)"; exit 1; }

shopt -s nullglob
for apk in "$DIST_DIR"/tronbrowser-android-*.apk; do
  echo "==> sign $apk"
  "$APKSIGNER" sign \
    --ks "$TB_KEYSTORE" \
    --ks-pass "pass:$TB_KEYSTORE_PASS" \
    --ks-key-alias "$TB_KEY_ALIAS" \
    --key-pass "pass:$TB_KEY_PASS" \
    "$apk"
  "$APKSIGNER" verify --verbose "$apk" | head -3
done

echo "sign: done"
