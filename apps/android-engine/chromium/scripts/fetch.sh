#!/usr/bin/env bash
# Fetch depot_tools, Ungoogled Chromium, and the pinned Chromium source with the
# Android toolchain (SDK/NDK are pulled by gclient when target_os includes
# 'android').
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

echo "==> chromium source @ $CHROMIUM_VERSION (Android — the big one)"
# .gclient must declare target_os = ['android'] BEFORE syncing so the Android
# SDK/NDK + build deps are fetched.
if [[ ! -f "$WORKDIR/.gclient" ]]; then
  cat > "$WORKDIR/.gclient" <<'GCLIENT'
solutions = [
  {
    "name": "src",
    "url": "https://chromium.googlesource.com/chromium/src.git",
    "managed": False,
    "custom_deps": {},
    "custom_vars": {},
  },
]
target_os = ["android"]
GCLIENT
fi

mkdir -p "$SRC_DIR"
( cd "$WORKDIR" && gclient sync --nohooks --with_branch_heads --revision "src@$CHROMIUM_VERSION" )

echo "==> Android build dependencies (needs sudo)"
if [[ -x "$SRC_DIR/build/install-build-deps.sh" ]]; then
  ( cd "$SRC_DIR" && ./build/install-build-deps.sh --android --no-prompt ) || \
    echo "  ! install-build-deps failed (run manually); continuing"
fi

echo "fetch: done"
