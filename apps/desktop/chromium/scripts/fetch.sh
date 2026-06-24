#!/usr/bin/env bash
# Fetch depot_tools, Ungoogled Chromium, and the pinned Chromium source.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"
require_run fetch

mkdir -p "$WORKDIR"
CHROMIUM_VERSION="$(read_cfg chromiumVersion)"
DEPOT_REPO="$(read_cfg depotToolsRepo)"
UNGOOGLED_REPO="$(read_cfg ungoogledChromiumRepo)"
UNGOOGLED_TAG="$(read_cfg ungoogledChromiumTag)"

echo "==> depot_tools"
[[ -d "$DEPOT_TOOLS_DIR" ]] || git clone --depth 1 "$DEPOT_REPO" "$DEPOT_TOOLS_DIR"
export PATH="$DEPOT_TOOLS_DIR:$PATH"

echo "==> ungoogled-chromium @ $UNGOOGLED_TAG"
[[ -d "$UNGOOGLED_DIR" ]] || git clone "$UNGOOGLED_REPO" "$UNGOOGLED_DIR"
git -C "$UNGOOGLED_DIR" fetch --tags --quiet
git -C "$UNGOOGLED_DIR" checkout "$UNGOOGLED_TAG"

echo "==> chromium source @ $CHROMIUM_VERSION (this is the big one)"
mkdir -p "$SRC_DIR"
( cd "$WORKDIR" && fetch --nohooks chromium )
git -C "$SRC_DIR" checkout "$CHROMIUM_VERSION"
( cd "$SRC_DIR" && gclient sync --nohooks --with_branch_heads )

echo "fetch: done"
