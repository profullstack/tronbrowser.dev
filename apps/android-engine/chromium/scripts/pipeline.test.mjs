import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'vitest';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const workdirs = [];

afterEach(() => {
  for (const workdir of workdirs.splice(0)) {
    rmSync(workdir, { recursive: true, force: true });
  }
});

function makeWorkdir(prefix) {
  const workdir = mkdtempSync(join(tmpdir(), prefix));
  workdirs.push(workdir);
  return workdir;
}

function runScript(name, workdir, extraEnv = {}) {
  return spawnSync('bash', [join(SCRIPT_DIR, name)], {
    cwd: join(SCRIPT_DIR, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      TB_RUN: '1',
      TB_TARGET_CPU: 'arm64',
      TB_WORKDIR: workdir,
      ...extraEnv,
    },
  });
}

test('package keeps every APK and AAB under a distinct name', () => {
  const workdir = makeWorkdir('tronbrowser-package-');
  const output = join(workdir, 'src', 'out', 'TronBrowserAndroid', 'apks');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'ChromePublic.apk'), 'apk-one');
  writeFileSync(join(output, 'ChromePublic64.apk'), 'apk-two');
  writeFileSync(join(output, 'ChromePublic.aab'), 'bundle');

  const result = runScript('package.sh', workdir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(
      join(workdir, 'dist', 'tronbrowser-android-arm64-ChromePublic.apk'),
      'utf8',
    ),
    'apk-one',
  );
  assert.equal(
    readFileSync(
      join(workdir, 'dist', 'tronbrowser-android-arm64-ChromePublic64.apk'),
      'utf8',
    ),
    'apk-two',
  );
  assert.equal(
    readFileSync(
      join(workdir, 'dist', 'tronbrowser-android-arm64-ChromePublic.aab'),
      'utf8',
    ),
    'bundle',
  );
});

test('package fails when the build produced no artifacts', () => {
  const workdir = makeWorkdir('tronbrowser-package-empty-');
  mkdirSync(join(workdir, 'src', 'out', 'TronBrowserAndroid', 'apks'), {
    recursive: true,
  });

  const result = runScript('package.sh', workdir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no \.apk\/\.aab found/);
});

test('sign chooses the newest SDK tool and keeps passwords out of argv', () => {
  const workdir = makeWorkdir('tronbrowser-sign-');
  const log = join(workdir, 'apksigner.log');
  const sdkRoot = join(
    workdir,
    'src',
    'third_party',
    'android_sdk',
    'public',
    'build-tools',
  );
  for (const version of ['34.0.0', '35.0.0']) {
    const tool = join(sdkRoot, version, 'apksigner');
    mkdirSync(dirname(tool), { recursive: true });
    writeFileSync(
      tool,
      [
        '#!/usr/bin/env bash',
        `printf '${version} %s %s %s\\n' "$TB_KEYSTORE_PASS" "$TB_KEY_PASS" "$*" >> "$APKSIGNER_LOG"`,
      ].join('\n'),
    );
    chmodSync(tool, 0o755);
  }
  mkdirSync(join(workdir, 'dist'), { recursive: true });
  writeFileSync(join(workdir, 'dist', 'tronbrowser-android-arm64-app.apk'), 'apk');
  writeFileSync(join(workdir, 'release.keystore'), 'fixture');

  const result = runScript('sign.sh', workdir, {
    APKSIGNER_LOG: log,
    PATH: '/usr/bin:/bin',
    TB_KEYSTORE: join(workdir, 'release.keystore'),
    TB_KEYSTORE_PASS: 'store-secret',
    TB_KEY_ALIAS: 'release',
    TB_KEY_PASS: 'key-secret',
  });
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(log, 'utf8');
  assert.match(calls, /^35\.0\.0/m);
  assert.doesNotMatch(calls, /^34\.0\.0/m);
  assert.match(calls, /store-secret key-secret/);
  assert.doesNotMatch(calls, /pass:store-secret|pass:key-secret/);
  assert.match(calls, /--ks-pass env:TB_KEYSTORE_PASS/);
  assert.match(calls, /--key-pass env:TB_KEY_PASS/);
});

test('sign fails cleanly when no apksigner is installed', () => {
  const workdir = makeWorkdir('tronbrowser-sign-missing-tool-');
  const keystore = join(workdir, 'release.keystore');
  writeFileSync(keystore, 'fixture');

  const result = runScript('sign.sh', workdir, {
    PATH: '/usr/bin:/bin',
    TB_KEYSTORE: keystore,
    TB_KEYSTORE_PASS: 'store-secret',
    TB_KEY_ALIAS: 'release',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /apksigner not found/);
  assert.doesNotMatch(result.stderr, /bad array subscript/);
});

test('apply-patches refuses an incomplete overlay before touching Chromium', () => {
  const workdir = makeWorkdir('tronbrowser-patches-');
  const result = runScript('apply-patches.sh', workdir);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing or empty required patch/);
  assert.doesNotMatch(result.stdout, /Ungoogled Chromium/);
});

test('tor refuses to stage placeholder artifacts', () => {
  const workdir = makeWorkdir('tronbrowser-tor-');
  const result = runScript('tor.sh', workdir);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /staging is not implemented/);
});

test('build enforces release preflight before generating GN args', () => {
  const contents = readFileSync(join(SCRIPT_DIR, 'build.sh'), 'utf8');
  const preflight = contents.indexOf('preflight.mjs" --mode release');
  const writeArgs = contents.indexOf('> "$OUT_DIR/args.gn"');
  const gnGen = contents.indexOf('gn gen');

  assert(preflight >= 0);
  assert(writeArgs > preflight);
  assert(gnGen > writeArgs);
});

test('fetch checks preflight and partial state before network operations', () => {
  const contents = readFileSync(join(SCRIPT_DIR, 'fetch.sh'), 'utf8');
  const preflight = contents.indexOf('preflight.mjs');
  const partialCheckout = contents.indexOf('incomplete Chromium checkout');
  const firstClone = contents.indexOf('git clone');

  assert(preflight >= 0);
  assert(partialCheckout > preflight);
  assert(firstClone > partialCheckout);
});
