import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vitest';

import { inspectCandidate, runCli } from './audit-candidate.mjs';

const fixtures = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const COMMIT_SHA = 'a'.repeat(40);
const BUILD_IDENTIFIER = 'c'.repeat(40);
const PATCH_BLOB_SHA = 'b'.repeat(40);
const CURRENT_VERSION = '151.0.7922.71';
const DEFAULT_PATCH_PATH = 'build/patches/extensions.patch';

function makeManifest(overrides = {}) {
  const candidate = {
    name: 'Cromite',
    repository: 'https://github.com/uazo/cromite',
    tag: `v${CURRENT_VERSION}-${BUILD_IDENTIFIER}`,
    commitSha: COMMIT_SHA,
    chromiumVersion: CURRENT_VERSION,
    publishedAt: '2026-08-10T00:00:00Z',
    ...overrides.candidate,
  };
  const patchPath = overrides.extensionSupport?.patchPath ?? DEFAULT_PATCH_PATH;
  const manifest = {
    $schemaVersion: 1,
    candidate,
    snapshot: {
      observedOn: '2026-08-12',
      recordedBy: 'reviewer',
      ...overrides.snapshot,
      chromeAndroidStable: {
        chromiumVersion: CURRENT_VERSION,
        sourceUrl:
          'https://chromereleases.googleblog.com/2026/08/chrome-for-android-update.html',
        ...overrides.snapshot?.chromeAndroidStable,
      },
    },
    policy: {
      maximumMajorLag: 1,
      maximumReleaseAgeDays: 35,
      maximumRecordAgeDays: 30,
      emergencySecurityUpdateSlaHours: 24,
      ...overrides.policy,
    },
    license: {
      spdxId: 'GPL-3.0',
      sourceUrl: `https://github.com/uazo/cromite/blob/${candidate.commitSha}/LICENSE`,
      decision: 'accepted',
      decidedBy: 'maintainer',
      decidedOn: '2026-08-11',
      ...overrides.license,
    },
    extensionSupport: {
      requirement: 'optional',
      status: 'experimental',
      enabledByDefault: false,
      patchPath,
      patchUrl: `https://github.com/uazo/cromite/blob/${candidate.tag}/${patchPath}`,
      patchBlobSha: PATCH_BLOB_SHA,
      attestedBy: 'reviewer',
      attestedOn: '2026-08-12',
      ...overrides.extensionSupport,
    },
  };

  const root = mkdtempSync(join(tmpdir(), 'tronbrowser-candidate-audit-'));
  const path = join(root, 'candidate.json');
  writeFileSync(path, JSON.stringify(manifest));
  fixtures.push(root);
  return path;
}

function makeRawManifest(content) {
  const root = mkdtempSync(join(tmpdir(), 'tronbrowser-candidate-audit-'));
  const path = join(root, 'candidate.json');
  writeFileSync(path, content);
  fixtures.push(root);
  return path;
}

test('accepts a current internally consistent candidate record', () => {
  const path = makeManifest();

  const result = inspectCandidate(path, { asOf: '2026-08-17' });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.metrics, {
    chromiumMajorLag: 0,
    releaseAgeDays: 7,
    snapshotAgeDays: 5,
    extensionAttestationAgeDays: 5,
  });
  assert.equal(result.provenance, 'attested-not-verified');
  assert.notEqual(
    result.manifest.candidate.tag.slice(-40),
    result.manifest.candidate.commitSha,
  );
});

test('reports policy, license, and product-decision adoption blockers', () => {
  const path = makeManifest({
    candidate: {
      tag: `v148.0.7778.168-${BUILD_IDENTIFIER}`,
      chromiumVersion: '148.0.7778.168',
      publishedAt: '2026-05-21T16:26:34Z',
    },
    policy: {
      emergencySecurityUpdateSlaHours: null,
    },
    license: {
      decision: 'pending',
      decidedBy: null,
      decidedOn: null,
    },
    extensionSupport: {
      requirement: 'undecided',
    },
  });

  const result = inspectCandidate(path, { asOf: '2026-08-17' });

  assert.deepEqual(result.errors, []);
  assert(result.blockers.some((item) => item.includes('GPL')));
  assert(result.blockers.some((item) => item.includes('extension requirement')));
  assert(result.blockers.some((item) => item.includes('3 Chromium majors')));
  assert(result.blockers.some((item) => item.includes('release is 88 days old')));
  assert(result.blockers.some((item) => item.includes('security update SLA')));
});

test('rejects unsafe or unverifiable provenance fields', () => {
  const path = makeManifest({
    candidate: {
      repository: 'https://attacker.example/cromite',
      commitSha: 'short',
    },
    snapshot: {
      observedOn: '2026-02-30',
      recordedBy: '',
      chromeAndroidStable: {
        sourceUrl: 'https://attacker.example/chrome-release',
      },
    },
    license: {
      spdxId: 'MIT',
      sourceUrl: 'https://attacker.example/LICENSE',
    },
    extensionSupport: {
      patchPath: '../extension.txt',
      patchUrl: 'https://attacker.example/extension.patch',
      patchBlobSha: 'short',
      attestedBy: '',
    },
  });

  const result = inspectCandidate(path, { asOf: '2026-08-17' });

  assert(result.errors.some((item) => item.includes('repository')));
  assert(result.errors.some((item) => item.includes('commitSha')));
  assert(result.errors.some((item) => item.includes('observedOn')));
  assert(result.errors.some((item) => item.includes('recordedBy')));
  assert(result.errors.some((item) => item.includes('patchPath')));
  assert(result.errors.some((item) => item.includes('patchUrl')));
  assert(
    result.errors.includes(
      'snapshot.chromeAndroidStable.sourceUrl must be an official Chrome Releases URL',
    ),
  );
  assert(
    result.errors.includes(
      'license.sourceUrl must pin Cromite LICENSE at candidate.commitSha',
    ),
  );
  assert(result.errors.some((item) => item.includes('spdxId')));
  assert(result.errors.some((item) => item.includes('patchBlobSha')));
  assert(result.errors.some((item) => item.includes('attestedBy')));
});

test('invalidates stale attestations even in record mode', () => {
  const path = makeManifest({
    snapshot: { observedOn: '2026-06-01' },
    extensionSupport: { attestedOn: '2026-06-01' },
  });

  const result = inspectCandidate(path, { asOf: '2026-08-17' });

  assert(result.errors.some((item) => item.includes('snapshot is stale')));
  assert(result.errors.some((item) => item.includes('attestation is stale')));

  const code = runCli(['--mode', 'record', '--as-of', '2026-08-17', '--json'], {
    defaultManifestPath: path,
    writeOut: () => {},
    writeError: () => {},
  });
  assert.equal(code, 1);
});

test('fails closed when a manifest is valid JSON but not an object', () => {
  for (const content of ['null', '[]']) {
    const path = makeRawManifest(content);
    const result = inspectCandidate(path, { asOf: '2026-08-17' });

    assert.deepEqual(result.errors, [`${path} must contain a JSON object`]);

    for (const json of [false, true]) {
      const output = [];
      const errors = [];
      const code = runCli(
        ['--mode', 'adopt', ...(json ? ['--json'] : [])],
        {
          defaultManifestPath: path,
          defaultAsOf: '2026-08-17',
          writeOut: (line) => output.push(line),
          writeError: (line) => errors.push(line),
        },
      );

      assert.equal(code, 1);
      if (json) {
        assert.equal(JSON.parse(output[0]).status, 'invalid');
      } else {
        assert(errors.some((line) => line.includes('must contain a JSON object')));
      }
    }
  }
});

test('accepts both precise GPL-3.0 SPDX variants', () => {
  for (const spdxId of ['GPL-3.0-only', 'GPL-3.0-or-later']) {
    const result = inspectCandidate(makeManifest({ license: { spdxId } }), {
      asOf: '2026-08-17',
    });

    assert.deepEqual(result.errors, []);
  }
});

test('rejects patch paths containing whitespace', () => {
  const path = makeManifest({
    extensionSupport: { patchPath: 'build/patches/my patch.patch' },
  });

  const result = inspectCandidate(path, { asOf: '2026-08-17' });

  assert(
    result.errors.includes(
      'extensionSupport.patchPath must be a safe relative patch path',
    ),
  );
});

test('treats a release later on the audit UTC day as age zero', () => {
  const path = makeManifest({
    candidate: { publishedAt: '2026-08-17T23:30:00Z' },
  });

  const result = inspectCandidate(path, { asOf: '2026-08-17' });

  assert.deepEqual(result.errors, []);
  assert.equal(result.metrics.releaseAgeDays, 0);
});

test('rejects a release on a future UTC calendar day', () => {
  const path = makeManifest({
    candidate: { publishedAt: '2026-08-18T00:00:00Z' },
  });

  const result = inspectCandidate(path, { asOf: '2026-08-17' });

  assert(result.errors.some((item) => item.includes('publishedAt cannot be after asOf')));
});

test('requires absolute ISO timestamps and strict audit dates', () => {
  const offsetless = makeManifest({
    candidate: { publishedAt: '2026-08-10T12:00:00' },
  });
  const invalidAsOf = makeManifest();

  const timestampResult = inspectCandidate(offsetless, { asOf: '2026-08-17' });
  const asOfResult = inspectCandidate(invalidAsOf, { asOf: '2026' });

  assert(
    timestampResult.errors.some((item) =>
      item.includes('publishedAt must be an ISO timestamp with an explicit UTC offset'),
    ),
  );
  assert(asOfResult.errors.some((item) => item.includes('asOf must be YYYY-MM-DD')));
});

test('produces the same date result in different host timezones', () => {
  const path = makeManifest({
    candidate: { publishedAt: '2026-08-17T00:30:00+07:00' },
  });
  const originalTimezone = process.env.TZ;

  try {
    process.env.TZ = 'Pacific/Honolulu';
    const honolulu = inspectCandidate(path, { asOf: '2026-08-17' });
    process.env.TZ = 'Asia/Tokyo';
    const tokyo = inspectCandidate(path, { asOf: '2026-08-17' });

    assert.equal(honolulu.metrics.releaseAgeDays, 1);
    assert.deepEqual(tokyo.metrics, honolulu.metrics);
    assert.deepEqual(tokyo.errors, honolulu.errors);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('rejects a license decision dated after the audit', () => {
  const path = makeManifest({
    license: { decidedOn: '2026-08-18' },
  });

  const result = inspectCandidate(path, { asOf: '2026-08-17' });

  assert(result.errors.some((item) => item.includes('decidedOn cannot be after asOf')));
});

test('record mode emits one JSON report without failing on adoption blockers', () => {
  const path = makeManifest({ license: { decision: 'pending' } });
  const output = [];
  const errors = [];

  const code = runCli(
    ['--mode', 'record', '--as-of', '2026-08-17', '--json'],
    {
      defaultManifestPath: path,
      writeOut: (line) => output.push(line),
      writeError: (line) => errors.push(line),
    },
  );

  assert.equal(code, 0);
  assert.equal(output.length, 1);
  assert.equal(errors.length, 0);
  const report = JSON.parse(output[0]);
  assert.equal(report.status, 'blocked');
  assert.equal(report.mode, 'record');
  assert.equal(report.provenance, 'attested-not-verified');
  assert.equal(report.policy.maximumMajorLag, 1);
  assert.equal(report.license.decision, 'pending');
  assert.equal(report.extensionSupport.requirement, 'optional');
});

test('adopt mode fails closed until blockers are resolved', () => {
  const path = makeManifest({ license: { decision: 'pending' } });

  const code = runCli(
    ['--mode', 'adopt', '--json'],
    {
      defaultManifestPath: path,
      defaultAsOf: '2026-08-17',
      writeOut: () => {},
      writeError: () => {},
    },
  );

  assert.equal(code, 1);
});

test('adopt mode succeeds for a fresh candidate with resolved decisions', () => {
  const path = makeManifest();

  const code = runCli(['--mode', 'adopt', '--json'], {
    defaultManifestPath: path,
    defaultAsOf: '2026-08-17',
    writeOut: () => {},
    writeError: () => {},
  });

  assert.equal(code, 0);
});

test('adopt mode refuses a caller-provided audit date', () => {
  const path = makeManifest();
  const output = [];

  const code = runCli(['--mode', 'adopt', '--as-of', '2026-08-10', '--json'], {
    defaultManifestPath: path,
    defaultAsOf: '2026-08-17',
    writeOut: (line) => output.push(line),
    writeError: () => {},
  });

  assert.equal(code, 2);
  assert.equal(JSON.parse(output[0]).errors[0], '--as-of is only available in record mode');
});

test('both manifest argument forms load the supplied record', () => {
  const path = makeManifest();

  for (const args of [
    ['--manifest', path, '--json'],
    [`--manifest=${path}`, '--json'],
  ]) {
    const output = [];
    const code = runCli(args, {
      defaultManifestPath: join(tmpdir(), 'unused-candidate.json'),
      defaultAsOf: '2026-08-17',
      writeOut: (line) => output.push(line),
      writeError: () => {},
    });

    assert.equal(code, 0);
    assert.equal(JSON.parse(output[0]).candidate.commitSha, COMMIT_SHA);
  }
});

test('a missing manifest reports one clear file-not-found error', () => {
  const root = mkdtempSync(join(tmpdir(), 'tronbrowser-missing-candidate-'));
  fixtures.push(root);

  const result = inspectCandidate(join(root, 'missing.json'), { asOf: '2026-08-17' });

  assert.equal(result.errors.length, 1);
  assert(result.errors[0].includes('file not found'));
  assert.deepEqual(result.blockers, []);
});

test('human output states the UTC audit date and attested provenance', () => {
  const path = makeManifest();
  const output = [];

  const code = runCli(['--mode', 'record'], {
    defaultManifestPath: path,
    defaultAsOf: '2026-08-17',
    writeOut: (line) => output.push(line),
    writeError: () => {},
  });

  assert.equal(code, 0);
  assert(output.includes('Audit date (UTC): 2026-08-17.'));
  assert(
    output.includes('Upstream facts are attested, not verified by this offline audit.'),
  );
});

test('invalid CLI arguments return usage status 2 as JSON', () => {
  const output = [];

  const code = runCli(['--mode', 'ship', '--json'], {
    writeOut: (line) => output.push(line),
    writeError: () => {},
  });

  assert.equal(code, 2);
  assert.equal(output.length, 1);
  const report = JSON.parse(output[0]);
  assert.equal(report.status, 'invalid');
  assert(report.errors[0].includes('record or adopt'));
});
