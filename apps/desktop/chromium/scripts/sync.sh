#!/usr/bin/env bash
# Run gclient hooks + sync runtime deps after fetch/checkout.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"
require_run sync

export PATH="$DEPOT_TOOLS_DIR:$PATH"
( cd "$SRC_DIR" && gclient runhooks )
echo "sync: done"
