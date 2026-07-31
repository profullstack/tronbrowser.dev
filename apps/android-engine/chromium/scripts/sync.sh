#!/usr/bin/env bash
# Run gclient hooks after fetch/checkout (pulls the Android SDK/NDK toolchain).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"
require_run sync

export PATH="$DEPOT_TOOLS_DIR:$PATH"
( cd "$SRC_DIR" && gclient runhooks )
echo "sync: done"
