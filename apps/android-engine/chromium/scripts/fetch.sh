#!/usr/bin/env bash
# Fetch depot_tools, Ungoogled Chromium, and the pinned Chromium source with the
# Android toolchain (SDK/NDK are pulled by gclient when target_os includes
# 'android').
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"
require_run fetch

# Validate the host before starting the expensive checkout. Release blockers,
# including the historical security pin, remain visible but are allowed here so
# they can be resolved against the checkout; build.sh enforces release readiness.
node "$HERE/preflight.mjs" --mode checkout --target-cpu "$TB_TARGET_CPU"

mkdir -p "$WORKDIR"
CHROMIUM_VERSION="$(read_cfg chromiumVersion)"
DEPOT_REPO="$(read_cfg depotToolsRepo)"
UNGOOGLED_REPO="$(read_cfg ungoogledChromiumRepo)"
UNGOOGLED_TAG="$(read_cfg ungoogledChromiumTag)"

# Refuse a partial checkout before performing any network work.
if [[ ! -d "$SRC_DIR/.git" && ( -e "$SRC_DIR" || -e "$WORKDIR/.gclient" ) ]]; then
  echo "incomplete Chromium checkout at $WORKDIR; move it aside and retry" >&2
  exit 1
fi

echo "==> depot_tools"
[[ -d "$DEPOT_TOOLS_DIR" ]] || git clone --depth 1 "$DEPOT_REPO" "$DEPOT_TOOLS_DIR"
export PATH="$DEPOT_TOOLS_DIR:$PATH"

echo "==> ungoogled-chromium @ $UNGOOGLED_TAG"
[[ -d "$UNGOOGLED_DIR" ]] || git clone "$UNGOOGLED_REPO" "$UNGOOGLED_DIR"
git -C "$UNGOOGLED_DIR" fetch --tags --quiet
git -C "$UNGOOGLED_DIR" checkout "$UNGOOGLED_TAG"

echo "==> chromium source @ $CHROMIUM_VERSION (Android — the big one)"
# `fetch android` creates both the checkout and a correct target_os-aware
# .gclient file. A hand-written .gclient plus an empty src directory does not.
if [[ ! -d "$SRC_DIR/.git" ]]; then
  ( cd "$WORKDIR" && fetch --nohooks android )
fi

( cd "$WORKDIR" && gclient sync --nohooks --with_branch_heads --with_tags \
    --revision "src@$CHROMIUM_VERSION" )

echo "==> Android build dependencies (needs sudo)"
if [[ -x "$SRC_DIR/build/install-build-deps.sh" ]]; then
  ( cd "$SRC_DIR" && ./build/install-build-deps.sh --android --no-prompt )
fi

echo "fetch: done"
