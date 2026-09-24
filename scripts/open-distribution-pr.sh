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
#
# --force-with-lease needs a remote-tracking ref to form its lease against. The
# release checkout is a fresh shallow clone of one ref, so refs/remotes/origin/
# <branch> does not exist and the push is rejected with "stale info" — which is
# exactly how the first chocolatey re-run died. Fetch the branch first so the
# lease has a basis, and it behaves as intended: overwrite our own earlier
# attempt, refuse if someone else moved it.
if git ls-remote --exit-code --heads origin "${BRANCH}" >/dev/null 2>&1; then
  echo "branch ${BRANCH} already exists on origin; force-updating it"
  git fetch --depth=1 origin "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"
  EXPECT="$(git rev-parse "refs/remotes/origin/${BRANCH}")"
  git checkout -B "${BRANCH}"
  git add distribution
  git commit -m "chore(distribution): refresh manifests for v${VERSION}"
  # The lease takes the expected commit, not a ref path.
  git push --force-with-lease="${BRANCH}:${EXPECT}" origin "${BRANCH}"
else
  git checkout -b "${BRANCH}"
  git add distribution
  git commit -m "chore(distribution): refresh manifests for v${VERSION}"
  git push origin "${BRANCH}"
fi

# An already-open PR for this branch is fine and expected on a re-run. Anything
# else — a denied token, a missing base — is a real failure and must not be
# swallowed: a silent success here is precisely how this pipeline went three
# months looking healthy while publishing nothing.
set +e
OUT="$(gh pr create \
  --base main \
  --head "${BRANCH}" \
  --title "chore(distribution): refresh manifests for v${VERSION}" \
  --body "Automated manifest refresh from the release pipeline for v${VERSION}.

Version strings and sha256 checksums are rewritten from the published release
assets by \`scripts/submit-packages.mjs\`." 2>&1)"
RC=$?
set -e

echo "${OUT}"

if [ "${RC}" -ne 0 ]; then
  if echo "${OUT}" | grep -qi "already exists"; then
    echo "a PR for ${BRANCH} already exists; branch updated in place"
  else
    echo "gh pr create failed for ${BRANCH}" >&2
    exit "${RC}"
  fi
fi
