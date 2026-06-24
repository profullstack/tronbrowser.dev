#!/usr/bin/env bash
# Apply the Ungoogled Chromium patch set, then the TronBrowser patch series.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"
require_run apply-patches

echo "==> Ungoogled Chromium: prune + patch"
# Domain substitution + pruning + upstream ungoogled patches.
python3 "$UNGOOGLED_DIR/utils/prune_binaries.py" "$SRC_DIR" "$UNGOOGLED_DIR/pruning.list" || true
python3 "$UNGOOGLED_DIR/utils/patches.py" apply "$SRC_DIR" "$UNGOOGLED_DIR/patches"
python3 "$UNGOOGLED_DIR/utils/domain_substitution.py" apply -r "$UNGOOGLED_DIR/domain_regex.list" \
        -f "$UNGOOGLED_DIR/domain_substitution.list" "$SRC_DIR"

echo "==> TronBrowser patch series"
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  patch_file="$PATCHES_DIR/$line"
  if [[ ! -s "$patch_file" ]]; then
    echo "  - skip (missing/empty): $line"
    continue
  fi
  echo "  - apply: $line"
  git -C "$SRC_DIR" apply "$patch_file"
done < "$PATCHES_DIR/series"

echo "==> branding"
cp "$BRANDING_DIR/BRANDING" "$SRC_DIR/chrome/app/theme/chromium/BRANDING"

echo "apply-patches: done"
