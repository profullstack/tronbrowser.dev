#!/usr/bin/env bash
# Publish a new version of a TronBrowser store extension from CI (or locally).
#
# Build-free: expects a prebuilt Manifest V3 bundle (a directory to zip, or a
# ready .zip/.crx). It (1) zips the bundle, (2) scps it to files.profullstack.com
# using your publisher SSH key, then (3) registers the new version via the store
# API with a publisher token. Generic — works from GitHub Actions, GitLab CI, or
# your shell. Requires: bash, curl, jq, ssh/scp, zip.
#
# The listing must already EXIST and have its one-time $1 fee paid (do that once
# in the web UI at <store>/store/submit.html). After that, every push is free
# and goes live instantly via this script.
#
# Required env:
#   TRONBROWSER_STORE_TOKEN   publisher API token (tbpub_...), minted in the web UI
#   TRONBROWSER_SSH_KEY       private SSH key registered with your publisher account
#   STORE_SLUG                the extension's slug
# Optional env:
#   STORE_URL   default https://tronbrowser.dev
#   SCP_TARGET  default files@files.profullstack.com
#   MANIFEST    path to manifest.json (default: manifest.json)
#   BUNDLE      dir to zip, or a .zip/.crx file (default: dist)
set -euo pipefail

STORE_URL="${STORE_URL:-https://tronbrowser.dev}"
SCP_TARGET="${SCP_TARGET:-files@files.profullstack.com}"
MANIFEST="${MANIFEST:-manifest.json}"
BUNDLE="${BUNDLE:-dist}"
: "${TRONBROWSER_STORE_TOKEN:?set TRONBROWSER_STORE_TOKEN (mint one in the store web UI)}"
: "${TRONBROWSER_SSH_KEY:?set TRONBROWSER_SSH_KEY (your publisher private key)}"
: "${STORE_SLUG:?set STORE_SLUG}"

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

# 1) Produce the artifact.
case "$BUNDLE" in
  *.zip|*.crx) artifact="$BUNDLE" ;;
  *) artifact="$work/${STORE_SLUG}.zip"; ( cd "$BUNDLE" && zip -qr "$artifact" . ) ;;
esac
fname="$(basename "$artifact")"
case "$fname" in *.crx) ftype=crx ;; *) ftype=zip ;; esac

# 2) Upload to files.profullstack.com under the slug's path.
key="$work/id_key"; printf '%s\n' "$TRONBROWSER_SSH_KEY" > "$key"; chmod 600 "$key"
host="${SCP_TARGET#*@}"
ssh-keyscan -H "$host" >> "$work/known_hosts" 2>/dev/null || true
scp -i "$key" -o UserKnownHostsFile="$work/known_hosts" "$artifact" \
  "${SCP_TARGET}:/public/extensions/${STORE_SLUG}/${fname}"

# 3) Resolve the listing id, then register the new version with the token.
id="$(curl -fsS "${STORE_URL}/api/store/extensions/${STORE_SLUG}" | jq -r '.id // empty')"
if [ -z "$id" ]; then
  echo "error: listing '${STORE_SLUG}' not found — create it and pay the one-time \$1 fee in the web UI first." >&2
  exit 1
fi

body="$(jq -n --argjson m "$(cat "$MANIFEST")" --arg f "$fname" --arg t "$ftype" \
  '{manifest: $m, files: {($t): $f}, source: "pr"}')"
resp="$(curl -fsS -X POST "${STORE_URL}/api/store/extensions/${id}/versions" \
  -H "authorization: Bearer ${TRONBROWSER_STORE_TOKEN}" \
  -H 'content-type: application/json' -d "$body")"

echo "published ${STORE_SLUG}: $resp"
