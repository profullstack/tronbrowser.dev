#!/usr/bin/env bash
# Shared environment for the TronBrowser Android engine build scripts.
# Mirrors apps/desktop/chromium/scripts/env.sh (same TB_RUN guard convention).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHROMIUM_DIR="$(cd "$HERE/.." && pwd)"          # apps/android-engine/chromium
CONFIG_DIR="$CHROMIUM_DIR/config"
PATCHES_DIR="$CHROMIUM_DIR/patches"
BRANDING_DIR="$CHROMIUM_DIR/branding"

# Work tree lives OUTSIDE the repo (Chromium src is ~50GB + the Android SDK/NDK
# add several more); override with $TB_WORKDIR.
WORKDIR="${TB_WORKDIR:-$HOME/.cache/tronbrowser-android-chromium}"
DEPOT_TOOLS_DIR="$WORKDIR/depot_tools"
UNGOOGLED_DIR="$WORKDIR/ungoogled-chromium"
SRC_DIR="$WORKDIR/src"                            # chromium checkout
OUT_DIR="$SRC_DIR/out/TronBrowserAndroid"
DIST_DIR="$WORKDIR/dist"

# Which CPU to build (arm64 = modern phones; arm = 32-bit; x64 = emulator).
TB_TARGET_CPU="${TB_TARGET_CPU:-arm64}"

read_cfg() { node -e "process.stdout.write(String(require('$CONFIG_DIR/version.json').$1))"; }

# Guard: these steps download/build many tens of GB. Require explicit opt-in.
require_run() {
  if [[ "${TB_RUN:-0}" != "1" ]]; then
    echo "[$1] dry-run. This step downloads/builds many GB (Android Chromium)."
    echo "      Re-run with TB_RUN=1 to execute for real."
    exit 0
  fi
}

export HERE CHROMIUM_DIR CONFIG_DIR PATCHES_DIR BRANDING_DIR \
       WORKDIR DEPOT_TOOLS_DIR UNGOOGLED_DIR SRC_DIR OUT_DIR DIST_DIR \
       TB_TARGET_CPU
