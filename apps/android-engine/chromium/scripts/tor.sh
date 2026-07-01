#!/usr/bin/env bash
# Stage a prebuilt Tor for Android so the fork can bundle it as an APK asset for
# the in-browser Tor toggle (patch 0007-tor-proxy-toggle). This mirrors the
# desktop model (apps/desktop/src/tor.ts): a local tor daemon exposes a SOCKS5
# port and Chromium is pointed at it via --proxy-server.
#
# Routes traffic through Tor (hides IP, reaches .onion). NOT Tor-Browser-grade
# anonymity — same caveat as docs/tor-onion-mode.md.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"
require_run tor

TOR_REPO="$(read_cfg torAndroid.repo)"
SOCKS_PORT="$(read_cfg torAndroid.socksPort)"
ASSETS_DIR="$SRC_DIR/chrome/android/tronbrowser/assets/tor"

echo "==> Tor for Android (SOCKS5 :$SOCKS_PORT) from $TOR_REPO"
mkdir -p "$ASSETS_DIR"

# The Guardian Project tor-android build produces per-ABI tor binaries/libs.
# Fetch a release matching our target CPU and drop it where the patch expects.
# (Left as an explicit step: pin a tor-android release tag, download the AAR,
#  extract jni/<abi>/libtor.so, and copy into $ASSETS_DIR.)
case "$TB_TARGET_CPU" in
  arm64) ABI="arm64-v8a" ;;
  arm)   ABI="armeabi-v7a" ;;
  x64)   ABI="x86_64" ;;
  *)     echo "unknown TB_TARGET_CPU=$TB_TARGET_CPU"; exit 1 ;;
esac
echo "  target ABI: $ABI  -> $ASSETS_DIR"
echo "  (pin a tor-android release and extract jni/$ABI/libtor.so here)"

echo "tor: staged asset dir for $ABI (SOCKS port $SOCKS_PORT)"
