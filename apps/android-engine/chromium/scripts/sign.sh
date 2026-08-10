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
export TB_KEYSTORE_PASS TB_KEY_PASS
[[ -f "$TB_KEYSTORE" ]] || { echo "keystore not found: $TB_KEYSTORE" >&2; exit 1; }

APKSIGNER="$(command -v apksigner || true)"
if [[ -z "$APKSIGNER" ]]; then
  mapfile -t APKSIGNER_CANDIDATES < <(
    find "$SRC_DIR/third_party/android_sdk/public/build-tools" -mindepth 2 \
      -maxdepth 2 -type f -name apksigner -perm -u+x 2>/dev/null | sort -V
  )
  if [[ "${#APKSIGNER_CANDIDATES[@]}" -gt 0 ]]; then
    APKSIGNER="${APKSIGNER_CANDIDATES[${#APKSIGNER_CANDIDATES[@]}-1]}"
  fi
fi
[[ -x "$APKSIGNER" ]] || { echo "apksigner not found (Android SDK build-tools)" >&2; exit 1; }

shopt -s nullglob
APKS=("$DIST_DIR"/tronbrowser-android-*.apk)
[[ "${#APKS[@]}" -gt 0 ]] || { echo "no packaged APKs found in $DIST_DIR" >&2; exit 1; }
for apk in "${APKS[@]}"; do
  echo "==> sign $apk"
  "$APKSIGNER" sign \
    --ks "$TB_KEYSTORE" \
    --ks-pass env:TB_KEYSTORE_PASS \
    --ks-key-alias "$TB_KEY_ALIAS" \
    --key-pass env:TB_KEY_PASS \
    "$apk"
  "$APKSIGNER" verify --verbose "$apk" | head -3
done

echo "sign: done"
