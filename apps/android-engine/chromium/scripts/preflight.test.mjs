import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vitest';

import { inspectAndroidEngine, runCli } from './preflight.mjs';

const fixtures = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeFixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tronbrowser-android-preflight-'));
  const config = {
    chromiumVersion: '131.0.6778.85',
    ungoogledChromiumTag: '131.0.6778.85-1',
    releaseApproved: true,
    ungoogledChromiumRepo: 'https://example.com/ungoogled.git',
    depotToolsRepo: 'https://example.com/depot-tools.git',
    targetOs: 'android',
    targetCpus: ['arm64', 'arm'],
    ninjaTargets: ['chrome_public_apk'],
    torAndroid: {
      repo: 'https://example.com/tor',
      integrationReady: true,
      version: '1.0.0',
      socksPort: 9071,
      artifacts: {
        arm64: {
          url: 'https://example.com/tor-arm64.tar.gz',
          sha256: 'a'.repeat(64),
        },
        arm: {
          url: 'https://example.com/tor-arm.tar.gz',
          sha256: 'b'.repeat(64),
        },
      },
    },
    ...overrides,
  };

  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'config', 'gn-args'), { recursive: true });
  mkdirSync(join(root, 'patches', 'tronbrowser-android'), { recursive: true });
  mkdirSync(join(root, 'branding', 'assets'), { recursive: true });
  writeFileSync(join(root, 'config', 'gn-args', 'common.gni'), 'is_debug = false\n');
  writeFileSync(join(root, 'config', 'version.json'), JSON.stringify(config));
  writeFileSync(
    join(root, 'config', 'gn-args', 'android.gni'),
    [
      'target_os = "android"',
      'target_cpu = "${TB_TARGET_CPU}"',
      'android_channel = "default"',
      'chrome_public_manifest_package = "dev.tronbrowser.browser"',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'branding', 'BRANDING'),
    [
      'COMPANY_FULLNAME=Profullstack, Inc.',
      'PRODUCT_FULLNAME=TronBrowser',
      'PRODUCT_SHORTNAME=TronBrowser',
      'ANDROID_APP_ID=dev.tronbrowser.browser',
    ].join('\n'),
  );
  writeFileSync(join(root, 'branding', 'assets', 'icon.png'), 'fixture');
  writeFileSync(
    join(root, 'patches', 'series'),
    'tronbrowser-android/0001-branding.patch\n',
  );
  writeFileSync(
    join(root, 'patches', 'tronbrowser-android', '0001-branding.patch'),
    'diff',
  );

  fixtures.push(root);
  return root;
}

test('accepts a complete, internally consistent fixture', () => {
  const root = makeFixture();

  const result = inspectAndroidEngine(root, { targetCpu: 'arm64' });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.blockers, []);
});

test('reports missing release inputs without invalidating the scaffold', () => {
  const root = makeFixture({
    torAndroid: {
      repo: 'https://example.com/tor',
      integrationReady: false,
      socksPort: 9071,
    },
  });
  rmSync(join(root, 'branding', 'assets', 'icon.png'));
  rmSync(join(root, 'patches', 'tronbrowser-android', '0001-branding.patch'));

  const result = inspectAndroidEngine(root, { targetCpu: 'arm64' });
  assert.deepEqual(result.errors, []);
  assert(result.blockers.some((item) => item.includes('patch body')));
  assert(result.blockers.some((item) => item.includes('branding/assets')));
  assert(result.blockers.some((item) => item.includes('torAndroid')));
  assert(result.blockers.some((item) => item.includes('not implemented')));
});

test('rejects mismatched versions and unconfigured target CPUs', () => {
  const root = makeFixture({ ungoogledChromiumTag: '130.0.0.0-1' });

  const result = inspectAndroidEngine(root, { targetCpu: 'x64' });
  assert(result.errors.some((item) => item.includes('must match')));
  assert(result.errors.some((item) => item.includes('not listed')));
});

test('rejects duplicate and escaping patch entries', () => {
  const root = makeFixture();
  writeFileSync(
    join(root, 'patches', 'series'),
    [
      'tronbrowser-android/0001-branding.patch',
      '../escape.patch',
      '../escape.patch',
    ].join('\n'),
  );

  const result = inspectAndroidEngine(root, { targetCpu: 'arm64' });
  assert(result.errors.some((item) => item.includes('unsafe patch')));
  assert(result.errors.some((item) => item.includes('duplicate patch')));
});

test('blocks an unapproved security pin and rejects misleading GN config', () => {
  const root = makeFixture({ releaseApproved: false });
  writeFileSync(
    join(root, 'config', 'gn-args', 'android.gni'),
    [
      'target_cpu = "${TB_TARGET_CPU}"',
      'android_channel = "beta"',
      'chrome_public_manifest_package = "org.chromium.chrome"',
      'enable_gvr_services = false',
    ].join('\n'),
  );

  const result = inspectAndroidEngine(root, { targetCpu: 'arm64' });
  assert(result.releaseBlockers.some((item) => item.includes('not approved')));
  assert.deepEqual(result.checkoutBlockers, []);
  assert(result.errors.some((item) => item.includes('enable_gvr_services')));
  assert(result.errors.some((item) => item.includes('ANDROID_APP_ID')));
  assert(result.errors.some((item) => item.includes('android_channel')));
});

test('rejects drift in supported CPUs and unreplaced GN placeholders', () => {
  const root = makeFixture({ targetCpus: ['arm64', 'x64'] });
  writeFileSync(
    join(root, 'config', 'gn-args', 'common.gni'),
    'is_debug = false\nvalue = "${TB_UNKNOWN}"\n',
  );

  const result = inspectAndroidEngine(root, { targetCpu: 'arm64' });
  assert(result.errors.some((item) => item.includes('unsupported target CPU')));
  assert(result.errors.some((item) => item.includes('exactly')));
  assert(result.errors.some((item) => item.includes('common.gni')));
});

test('JSON mode emits one machine-readable scaffold report', () => {
  const root = makeFixture({ releaseApproved: false });
  const output = [];
  const errors = [];

  const code = runCli(['--mode', 'scaffold', '--json'], {
    root,
    writeOut: (line) => output.push(line),
    writeError: (line) => errors.push(line),
  });

  assert.equal(code, 0);
  assert.equal(output.length, 1);
  assert.equal(errors.length, 0);
  const report = JSON.parse(output[0]);
  assert.equal(report.status, 'blocked');
  assert.equal(report.mode, 'scaffold');
  assert.equal(report.targetCpu, 'arm64');
  assert.equal(report.chromiumVersion, '131.0.6778.85');
  assert.equal(report.fatalBlockers.length, 0);
  assert(report.releaseBlockers.some((item) => item.includes('not approved')));
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
  assert(report.errors[0].includes('scaffold, checkout, or release'));
});

test('missing option values preserve JSON error output', () => {
  const output = [];
  const errors = [];

  const code = runCli(['--target-cpu', '--json'], {
    writeOut: (line) => output.push(line),
    writeError: (line) => errors.push(line),
  });

  assert.equal(code, 2);
  assert.equal(output.length, 1);
  assert.equal(errors.length, 0);
  const report = JSON.parse(output[0]);
  assert.equal(report.status, 'invalid');
  assert.equal(report.errors[0], '--target-cpu requires a value');
});
