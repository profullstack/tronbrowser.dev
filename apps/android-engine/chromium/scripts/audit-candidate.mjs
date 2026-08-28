#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = resolve(SCRIPT_DIR, '..', 'config', 'cromite-candidate.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const GITHUB_API_ROOT = 'https://api.github.com';
const MAX_TAG_DEPTH = 8;
const FULL_SHA = /^[a-f0-9]{40}$/i;
const LICENSE_DECISIONS = new Set(['pending', 'accepted', 'rejected']);
const CROMITE_REPOSITORY = 'https://github.com/uazo/cromite';
const CROMITE_REPOSITORY_PATH = '/uazo/cromite';
const CROMITE_LICENSE_IDS = new Set([
  'GPL-3.0',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
]);
const EXTENSION_REQUIREMENTS = new Set(['undecided', 'optional', 'required']);
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function parseJson(path, errors) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push(`${path} must contain a JSON object`);
      return null;
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      errors.push(`cannot read ${path}: file not found`);
    } else {
      errors.push(`cannot parse ${path}: ${error.message}`);
    }
    return null;
  }
}

function parseHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isCanonicalCromiteRepository(value) {
  const parsed = parseHttpsUrl(value);
  return (
    parsed?.origin === 'https://github.com' &&
    parsed.pathname.replace(/\/$/, '') === CROMITE_REPOSITORY_PATH
  );
}

function isPinnedCromiteUrl(value, expectedPath) {
  const parsed = parseHttpsUrl(value);
  return (
    parsed?.origin === 'https://github.com' &&
    parsed.pathname === `${CROMITE_REPOSITORY_PATH}${expectedPath}`
  );
}

function isOfficialChromeReleaseUrl(value) {
  const parsed = parseHttpsUrl(value);
  return (
    parsed?.hostname === 'chromereleases.googleblog.com' &&
    parsed.pathname !== '/'
  );
}

function isSafePatchPath(value) {
  return (
    typeof value === 'string' &&
    value.endsWith('.patch') &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !/\s/.test(value) &&
    value.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

function isValidCalendarDate(year, month, day) {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function parseDate(value, label, errors, { dateOnly = false } = {}) {
  if (typeof value !== 'string') {
    errors.push(`${label} must be ${dateOnly ? 'YYYY-MM-DD' : 'an ISO timestamp'}`);
    return null;
  }

  if (dateOnly) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      errors.push(`${label} must be YYYY-MM-DD`);
      return null;
    }
    const [, year, month, day] = match.map(Number);
    if (!isValidCalendarDate(year, month, day)) {
      errors.push(`${label} is not a valid date`);
      return null;
    }
    return new Date(`${value}T00:00:00Z`);
  }

  const match = ISO_INSTANT.exec(value);
  if (!match) {
    errors.push(`${label} must be an ISO timestamp with an explicit UTC offset`);
    return null;
  }
  const [, year, month, day, hour, minute, second, , , , offsetHour, offsetMinute] =
    match;
  if (
    !isValidCalendarDate(Number(year), Number(month), Number(day)) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (offsetHour !== undefined &&
      (Number(offsetHour) > 23 || Number(offsetMinute) > 59))
  ) {
    errors.push(`${label} is not a valid date`);
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    errors.push(`${label} is not a valid date`);
    return null;
  }
  return parsed;
}

function nonNegativeInteger(value, label, errors) {
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${label} must be a non-negative integer`);
    return false;
  }
  return true;
}

function positiveInteger(value, label, errors) {
  if (!Number.isInteger(value) || value < 1) {
    errors.push(`${label} must be a positive integer`);
    return false;
  }
  return true;
}

function majorOf(version, label, errors) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
    errors.push(`${label} must be a four-part numeric version`);
    return null;
  }
  return Number(version.split('.')[0]);
}

function ageInDays(later, earlier) {
  const utcDay = (value) =>
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  return Math.floor((utcDay(later) - utcDay(earlier)) / DAY_MS);
}

function encodeRepositoryPath(path) {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function fetchGitHubJson(fetchImpl, path, label) {
  let response;
  try {
    response = await fetchImpl(`${GITHUB_API_ROOT}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'tronbrowser-cromite-audit',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (error) {
    throw new Error(`${label}: request failed: ${error?.message ?? String(error)}`);
  }

  if (!response || response.ok !== true) {
    const status = Number.isInteger(response?.status) ? ` (${response.status})` : '';
    throw new Error(`${label}: GitHub API request failed${status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`${label}: invalid JSON response: ${error?.message ?? String(error)}`);
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${label}: GitHub API response must be an object`);
  }
  return payload;
}

async function resolveTagCommit(fetchImpl, tag) {
  const ref = await fetchGitHubJson(
    fetchImpl,
    `/repos/uazo/cromite/git/ref/tags/${encodeURIComponent(tag)}`,
    `tag ref ${tag}`,
  );
  let target = ref.object;
  const visited = new Set();

  for (let depth = 0; depth <= MAX_TAG_DEPTH; depth += 1) {
    if (
      target === null ||
      typeof target !== 'object' ||
      !FULL_SHA.test(target.sha ?? '')
    ) {
      throw new Error(`tag ref ${tag}: invalid target object`);
    }
    if (target.type === 'commit') return target.sha;
    if (target.type !== 'tag') {
      throw new Error(`tag ref ${tag}: unsupported target type ${target.type ?? 'missing'}`);
    }
    if (depth === MAX_TAG_DEPTH) {
      throw new Error(`tag ref ${tag}: annotated tag depth exceeds ${MAX_TAG_DEPTH}`);
    }
    if (visited.has(target.sha)) {
      throw new Error(`tag ref ${tag}: annotated tag cycle detected`);
    }
    visited.add(target.sha);
    const annotated = await fetchGitHubJson(
      fetchImpl,
      `/repos/uazo/cromite/git/tags/${target.sha}`,
      `annotated tag ${target.sha}`,
    );
    target = annotated.object;
  }

  throw new Error(`tag ref ${tag}: could not resolve a commit`);
}

function addDifference(differences, field, recorded, observed, matches) {
  if (!matches) differences.push({ field, recorded, observed });
}

export async function verifyLiveCandidate(
  manifest,
  {
    asOf = new Date().toISOString().slice(0, 10),
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const errors = [];
  const differences = [];
  const observed = {
    tag: null,
    commitSha: null,
    publishedAt: null,
    licenseBlobSha: null,
    patchBlobSha: null,
    releaseAgeDays: null,
  };
  const auditDate = parseDate(asOf, 'asOf', errors, { dateOnly: true });

  if (typeof fetchImpl !== 'function') {
    errors.push('live verification requires a fetch implementation');
  }
  if (!isSafePatchPath(manifest?.extensionSupport?.patchPath)) {
    errors.push('live verification requires a safe extension patch path');
  }
  if (errors.length > 0) {
    return { status: 'failed', asOf, errors, differences, observed };
  }

  try {
    const release = await fetchGitHubJson(
      fetchImpl,
      '/repos/uazo/cromite/releases/latest',
      'latest release',
    );
    if (typeof release.tag_name !== 'string' || !release.tag_name) {
      throw new Error('latest release: tag_name is missing');
    }
    const publishedAt = parseDate(
      release.published_at,
      'latest release published_at',
      errors,
    );
    if (!publishedAt) {
      return { status: 'failed', asOf, errors, differences, observed };
    }

    observed.tag = release.tag_name;
    observed.publishedAt = release.published_at;
    observed.commitSha = await resolveTagCommit(fetchImpl, observed.tag);

    const license = await fetchGitHubJson(
      fetchImpl,
      `/repos/uazo/cromite/contents/LICENSE?ref=${encodeURIComponent(observed.commitSha)}`,
      'LICENSE blob',
    );
    if (license.type !== 'file' || !FULL_SHA.test(license.sha ?? '')) {
      throw new Error('LICENSE blob: response does not describe a pinned file blob');
    }
    observed.licenseBlobSha = license.sha;

    const patchPath = encodeRepositoryPath(manifest.extensionSupport.patchPath);
    const patch = await fetchGitHubJson(
      fetchImpl,
      `/repos/uazo/cromite/contents/${patchPath}?ref=${encodeURIComponent(observed.commitSha)}`,
      'extension patch blob',
    );
    if (patch.type !== 'file' || !FULL_SHA.test(patch.sha ?? '')) {
      throw new Error(
        'extension patch blob: response does not describe a pinned file blob',
      );
    }
    observed.patchBlobSha = patch.sha;
    observed.releaseAgeDays = ageInDays(auditDate, publishedAt);

    const recordedPublishedAt = parseDate(
      manifest?.candidate?.publishedAt,
      'candidate.publishedAt',
      errors,
    );
    addDifference(
      differences,
      'candidate.tag',
      manifest?.candidate?.tag ?? null,
      observed.tag,
      manifest?.candidate?.tag === observed.tag,
    );
    addDifference(
      differences,
      'candidate.commitSha',
      manifest?.candidate?.commitSha ?? null,
      observed.commitSha,
      manifest?.candidate?.commitSha === observed.commitSha,
    );
    addDifference(
      differences,
      'candidate.publishedAt',
      manifest?.candidate?.publishedAt ?? null,
      observed.publishedAt,
      recordedPublishedAt?.getTime() === publishedAt.getTime(),
    );
    addDifference(
      differences,
      'license.blobSha',
      manifest?.license?.blobSha ?? null,
      observed.licenseBlobSha,
      manifest?.license?.blobSha === observed.licenseBlobSha,
    );
    addDifference(
      differences,
      'extensionSupport.patchBlobSha',
      manifest?.extensionSupport?.patchBlobSha ?? null,
      observed.patchBlobSha,
      manifest?.extensionSupport?.patchBlobSha === observed.patchBlobSha,
    );
    const recordedReleaseAgeDays = recordedPublishedAt
      ? ageInDays(auditDate, recordedPublishedAt)
      : null;
    addDifference(
      differences,
      'metrics.releaseAgeDays',
      recordedReleaseAgeDays,
      observed.releaseAgeDays,
      recordedReleaseAgeDays === observed.releaseAgeDays,
    );
  } catch (error) {
    errors.push(error?.message ?? String(error));
  }

  return {
    status: errors.length === 0 && differences.length === 0 ? 'verified' : 'failed',
    asOf,
    errors,
    differences,
    observed,
  };
}

export function inspectCandidate(
  manifestPath = DEFAULT_MANIFEST,
  { asOf = new Date().toISOString().slice(0, 10) } = {},
) {
  const errors = [];
  const blockers = [];
  const manifest = parseJson(manifestPath, errors);
  const metrics = {
    chromiumMajorLag: null,
    releaseAgeDays: null,
    snapshotAgeDays: null,
    extensionAttestationAgeDays: null,
  };
  if (manifest === null) {
    return {
      asOf,
      provenance: 'attested-not-verified',
      errors,
      blockers,
      metrics,
      manifest: {},
    };
  }
  const candidate = manifest.candidate ?? {};
  const snapshot = manifest.snapshot ?? {};
  const stable = snapshot.chromeAndroidStable ?? {};
  const policy = manifest.policy ?? {};
  const license = manifest.license ?? {};
  const extension = manifest.extensionSupport ?? {};

  if (manifest.$schemaVersion !== 1) {
    errors.push('$schemaVersion must be 1');
  }
  if (candidate.name !== 'Cromite') {
    errors.push('candidate.name must be Cromite');
  }
  if (!isCanonicalCromiteRepository(candidate.repository)) {
    errors.push(`candidate.repository must be ${CROMITE_REPOSITORY}`);
  }
  const validCommitSha = /^[a-f0-9]{40}$/i.test(candidate.commitSha ?? '');
  if (!validCommitSha) {
    errors.push('candidate.commitSha must be a full 40-character commit SHA');
  }

  const candidateMajor = majorOf(
    candidate.chromiumVersion,
    'candidate.chromiumVersion',
    errors,
  );
  const stableMajor = majorOf(
    stable.chromiumVersion,
    'snapshot.chromeAndroidStable.chromiumVersion',
    errors,
  );
  const escapedCandidateVersion =
    typeof candidate.chromiumVersion === 'string'
      ? candidate.chromiumVersion.replace(/\./g, '\\.')
      : '';
  const validTag =
    candidateMajor !== null &&
    typeof candidate.tag === 'string' &&
    new RegExp(`^v${escapedCandidateVersion}-[a-f0-9]{40}$`, 'i').test(candidate.tag);
  if (!validTag) {
    errors.push(
      'candidate.tag must contain the pinned Chromium version and a 40-character Cromite build identifier',
    );
  }

  const auditDate = parseDate(asOf, 'asOf', errors, { dateOnly: true });
  const publishedAt = parseDate(candidate.publishedAt, 'candidate.publishedAt', errors);
  const observedOn = parseDate(snapshot.observedOn, 'snapshot.observedOn', errors, {
    dateOnly: true,
  });
  const attestedOn = parseDate(
    extension.attestedOn,
    'extensionSupport.attestedOn',
    errors,
    { dateOnly: true },
  );

  if (typeof snapshot.recordedBy !== 'string' || !snapshot.recordedBy.trim()) {
    errors.push('snapshot.recordedBy is required');
  }
  if (!isOfficialChromeReleaseUrl(stable.sourceUrl)) {
    errors.push('snapshot.chromeAndroidStable.sourceUrl must be an official Chrome Releases URL');
  }

  const validMaximumMajorLag = nonNegativeInteger(
    policy.maximumMajorLag,
    'policy.maximumMajorLag',
    errors,
  );
  const validMaximumReleaseAge = positiveInteger(
    policy.maximumReleaseAgeDays,
    'policy.maximumReleaseAgeDays',
    errors,
  );
  const validMaximumRecordAge = positiveInteger(
    policy.maximumRecordAgeDays,
    'policy.maximumRecordAgeDays',
    errors,
  );
  if (policy.emergencySecurityUpdateSlaHours !== null) {
    positiveInteger(
      policy.emergencySecurityUpdateSlaHours,
      'policy.emergencySecurityUpdateSlaHours',
      errors,
    );
  }

  if (
    !validCommitSha ||
    !isPinnedCromiteUrl(license.sourceUrl, `/blob/${candidate.commitSha}/LICENSE`)
  ) {
    errors.push('license.sourceUrl must pin Cromite LICENSE at candidate.commitSha');
  }
  if (!CROMITE_LICENSE_IDS.has(license.spdxId)) {
    errors.push(
      'license.spdxId must be GPL-3.0, GPL-3.0-only, or GPL-3.0-or-later',
    );
  }
  if (!FULL_SHA.test(license.blobSha ?? '')) {
    errors.push('license.blobSha must be a full 40-character blob SHA');
  }
  let decidedOn = null;
  if (!LICENSE_DECISIONS.has(license.decision)) {
    errors.push('license.decision must be pending, accepted, or rejected');
  } else if (license.decision === 'pending') {
    blockers.push('GPL distribution obligations have not been accepted');
  } else {
    if (typeof license.decidedBy !== 'string' || !license.decidedBy.trim()) {
      errors.push('license.decidedBy is required for a final decision');
    }
    decidedOn = parseDate(license.decidedOn, 'license.decidedOn', errors, {
      dateOnly: true,
    });
    if (license.decision === 'rejected') {
      blockers.push('Cromite was rejected as a production source on license grounds');
    }
  }
  if (auditDate && decidedOn && ageInDays(auditDate, decidedOn) < 0) {
    errors.push('license.decidedOn cannot be after asOf');
  }

  if (!EXTENSION_REQUIREMENTS.has(extension.requirement)) {
    errors.push('extensionSupport.requirement must be undecided, optional, or required');
  } else if (extension.requirement === 'undecided') {
    blockers.push('the Android extension requirement is still undecided');
  }
  if (!['experimental', 'validated'].includes(extension.status)) {
    errors.push('extensionSupport.status must be experimental or validated');
  }
  if (typeof extension.enabledByDefault !== 'boolean') {
    errors.push('extensionSupport.enabledByDefault must be a boolean');
  }
  const validPatchPath = isSafePatchPath(extension.patchPath);
  if (!validPatchPath) {
    errors.push('extensionSupport.patchPath must be a safe relative patch path');
  }
  if (
    !validTag ||
    !validPatchPath ||
    !isPinnedCromiteUrl(
      extension.patchUrl,
      `/blob/${candidate.tag}/${extension.patchPath}`,
    )
  ) {
    errors.push('extensionSupport.patchUrl must pin patchPath at candidate.tag');
  }
  if (!FULL_SHA.test(extension.patchBlobSha ?? '')) {
    errors.push('extensionSupport.patchBlobSha must be a full 40-character blob SHA');
  }
  if (typeof extension.attestedBy !== 'string' || !extension.attestedBy.trim()) {
    errors.push('extensionSupport.attestedBy is required');
  }
  if (extension.requirement === 'required' && extension.status !== 'validated') {
    blockers.push('required Android extension support has not been validated');
  }
  if (extension.requirement === 'required' && extension.enabledByDefault !== true) {
    blockers.push('required Android extension support is disabled by default');
  }

  if (candidateMajor !== null && stableMajor !== null) {
    metrics.chromiumMajorLag = stableMajor - candidateMajor;
    if (metrics.chromiumMajorLag < 0) {
      errors.push('candidate Chromium major cannot be newer than the recorded stable major');
    } else if (
      validMaximumMajorLag &&
      metrics.chromiumMajorLag > policy.maximumMajorLag
    ) {
      blockers.push(
        `candidate is ${metrics.chromiumMajorLag} Chromium majors behind the recorded stable release (policy allows ${policy.maximumMajorLag})`,
      );
    }
  }

  if (auditDate && publishedAt) {
    metrics.releaseAgeDays = ageInDays(auditDate, publishedAt);
    if (metrics.releaseAgeDays < 0) {
      errors.push('candidate.publishedAt cannot be after asOf');
    } else if (
      validMaximumReleaseAge &&
      metrics.releaseAgeDays > policy.maximumReleaseAgeDays
    ) {
      blockers.push(
        `candidate release is ${metrics.releaseAgeDays} days old (policy allows ${policy.maximumReleaseAgeDays})`,
      );
    }
  }

  if (auditDate && observedOn) {
    metrics.snapshotAgeDays = ageInDays(auditDate, observedOn);
    if (metrics.snapshotAgeDays < 0) {
      errors.push('snapshot.observedOn cannot be after asOf');
    } else if (
      validMaximumRecordAge &&
      metrics.snapshotAgeDays > policy.maximumRecordAgeDays
    ) {
      errors.push(
        `candidate snapshot is stale at ${metrics.snapshotAgeDays} days old (policy allows ${policy.maximumRecordAgeDays})`,
      );
    }
  }

  if (auditDate && attestedOn) {
    metrics.extensionAttestationAgeDays = ageInDays(auditDate, attestedOn);
    if (metrics.extensionAttestationAgeDays < 0) {
      errors.push('extensionSupport.attestedOn cannot be after asOf');
    } else if (
      validMaximumRecordAge &&
      metrics.extensionAttestationAgeDays > policy.maximumRecordAgeDays
    ) {
      errors.push(
        `extension attestation is stale at ${metrics.extensionAttestationAgeDays} days old (policy allows ${policy.maximumRecordAgeDays})`,
      );
    }
  }

  if (policy.emergencySecurityUpdateSlaHours === null) {
    blockers.push('emergency security update SLA is not defined');
  }

  return {
    asOf,
    provenance: 'attested-not-verified',
    errors,
    blockers,
    metrics,
    manifest,
  };
}

function parseArgs(args, defaultManifestPath, defaultAsOf) {
  let mode = 'record';
  let manifestPath = defaultManifestPath;
  let asOf = defaultAsOf;
  let asOfProvided = false;
  let json = false;
  let live = false;
  let explain = false;

  const nextValue = (index, name) => {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    return value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') json = true;
    else if (arg === '--live') live = true;
    else if (arg === '--explain') explain = true;
    else if (arg === '--mode') mode = nextValue(index++, '--mode');
    else if (arg.startsWith('--mode=')) mode = arg.slice('--mode='.length);
    else if (arg === '--manifest') manifestPath = nextValue(index++, '--manifest');
    else if (arg.startsWith('--manifest=')) {
      manifestPath = arg.slice('--manifest='.length);
    } else if (arg === '--as-of') {
      asOf = nextValue(index++, '--as-of');
      asOfProvided = true;
    } else if (arg.startsWith('--as-of=')) {
      asOf = arg.slice('--as-of='.length);
      asOfProvided = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!['record', 'adopt'].includes(mode)) {
    throw new Error(`mode must be record or adopt; received: ${mode}`);
  }
  if (mode === 'adopt' && asOfProvided) {
    throw new Error('--as-of is only available in record mode');
  }
  if (explain && !live) {
    throw new Error('--explain requires --live');
  }
  return { mode, manifestPath, asOf, json, live, explain };
}

function reportFor(result, mode, liveVerification = null) {
  return {
    status:
      result.errors.length > 0
        ? 'invalid'
        : liveVerification && liveVerification.status !== 'verified'
          ? 'mismatch'
        : result.blockers.length > 0
          ? 'blocked'
          : 'ready',
    mode,
    asOf: result.asOf,
    provenance: liveVerification
      ? liveVerification.status === 'verified'
        ? 'live-verified'
        : 'live-verification-failed'
      : result.provenance,
    candidate: result.manifest.candidate ?? null,
    metrics: result.metrics,
    policy: result.manifest.policy ?? null,
    license: result.manifest.license ?? null,
    extensionSupport: result.manifest.extensionSupport ?? null,
    errors: result.errors,
    blockers: result.blockers,
    liveVerification,
  };
}

function writeHumanReport(result, options, liveVerification, writeOut, writeError) {
  writeOut(`Audit date (UTC): ${result.asOf}.`);
  if (result.errors.length > 0) {
    writeError('Cromite candidate record is invalid:');
    for (const error of result.errors) writeError(`  - ${error}`);
    return;
  }

  const candidate = result.manifest.candidate;
  writeOut(
    `Cromite candidate record is valid: ${candidate.tag} @ ${candidate.commitSha}.`,
  );
  if (liveVerification) {
    if (liveVerification.status === 'verified') {
      writeOut('Live GitHub verification matched every recorded upstream fact.');
    } else {
      writeError('Live GitHub verification failed:');
      for (const error of liveVerification.errors) writeError(`  - ${error}`);
      if (options.explain) {
        for (const difference of liveVerification.differences) {
          writeError(
            `  - ${difference.field}: recorded=${JSON.stringify(difference.recorded)} observed=${JSON.stringify(difference.observed)}`,
          );
        }
      } else if (liveVerification.differences.length > 0) {
        writeError(
          `  - ${liveVerification.differences.length} recorded value(s) differ; rerun with --explain`,
        );
      }
    }
  } else {
    writeOut('Upstream facts are attested, not verified by this offline audit.');
  }
  writeOut(
    `Recorded lag: ${result.metrics.chromiumMajorLag} Chromium majors; release age: ${result.metrics.releaseAgeDays} days.`,
  );
  if (result.blockers.length > 0) {
    writeOut(`Adoption blockers (${result.blockers.length}):`);
    for (const blocker of result.blockers) writeOut(`  - ${blocker}`);
  } else {
    writeOut('No adoption blockers found.');
  }
}

export function runCli(
  args = process.argv.slice(2),
  {
    defaultManifestPath = DEFAULT_MANIFEST,
    defaultAsOf = new Date().toISOString().slice(0, 10),
    fetchImpl = globalThis.fetch,
    writeOut = (line) => console.log(line),
    writeError = (line) => console.error(line),
  } = {},
) {
  const jsonRequested = args.includes('--json');
  let options;
  try {
    options = parseArgs(args, defaultManifestPath, defaultAsOf);
  } catch (error) {
    if (jsonRequested) {
      writeOut(JSON.stringify({ status: 'invalid', errors: [error.message] }));
    } else {
      writeError(`candidate audit: ${error.message}`);
    }
    return 2;
  }

  const result = inspectCandidate(options.manifestPath, { asOf: options.asOf });
  const finish = (liveVerification = null) => {
    const report = reportFor(result, options.mode, liveVerification);
    if (options.json) {
      writeOut(JSON.stringify(report, null, 2));
    } else {
      writeHumanReport(result, options, liveVerification, writeOut, writeError);
    }

    if (result.errors.length > 0) return 1;
    if (liveVerification && liveVerification.status !== 'verified') return 1;
    if (options.mode === 'adopt' && result.blockers.length > 0) {
      if (!options.json) {
        writeError('candidate audit: refusing adoption until blockers are resolved');
      }
      return 1;
    }
    return 0;
  };

  if (!options.live || result.errors.length > 0) return finish();
  return verifyLiveCandidate(result.manifest, {
    asOf: options.asOf,
    fetchImpl,
  }).then(finish);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  Promise.resolve(runCli()).then((code) => {
    process.exitCode = code;
  });
}
