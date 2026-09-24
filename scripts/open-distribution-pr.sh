#!/usr/bin/env bash
# Open a PR with the manifests submit-packages.mjs just refreshed.
#
# Why this exists: the refresh rewrites files under distribution/ on the runner
# and nothing ever persisted them, so every manifest in git stayed frozen at the
# version it was scaffolded with (0.1.0/0.1.1) while releases went out to 3.15.0.
# Those manifests are the input to every channel's submission, so a stale tree
# means even a working submit publishes the wrong version.
#
# A PR rather than a push to main: main is protected, and a bad checksum should
# be reviewable before it reaches a package manager.
set -euo pipefail

: "${VERSION:?VERSION must be set}"

if git diff --quiet -- distribution; then
  echo "distribution/ already current for v${VERSION}, nothing to commit"
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

BRANCH="chore/distribution-${VERSION}"

# A re-run of the same release must not fail on an existing branch.
if git ls-remote --exit-code --heads origin "${BRANCH}" >/dev/null 2>&1; then
  echo "branch ${BRANCH} already exists on origin; force-updating it"
  git checkout -B "${BRANCH}"
  git add distribution
  git commit -m "chore(distribution): refresh manifests for v${VERSION}"
  git push --force-with-lease origin "${BRANCH}"
else
  git checkout -b "${BRANCH}"
  git add distribution
  git commit -m "chore(distribution): refresh manifests for v${VERSION}"
  git push origin "${BRANCH}"
fi

# `gh pr create` fails if one is already open for the branch, which is fine.
gh pr create \
  --base main \
  --head "${BRANCH}" \
  --title "chore(distribution): refresh manifests for v${VERSION}" \
  --body "Automated manifest refresh from the release pipeline for v${VERSION}.

Version strings and sha256 checksums are rewritten from the published release
assets by \`scripts/submit-packages.mjs\`." \
  || echo "a PR for ${BRANCH} already exists; branch updated in place"
