// tron-doctor is what a user runs when the browser shows "Something went wrong
// when opening your profile". Two things have to hold: the report names the
// real cause among the ones that produce that dialog, and repair never takes a
// step that loses data it cannot get back. Both are pinned here against
// synthetic profiles, with the engine stubbed.

import { spawnSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCTOR = join(HERE, '..', 'launcher', 'tron-doctor');

type Env = { home: string; profile: string; engine: string };

function setup(engineVersion = 'Chromium 151.0.7922.173'): Env {
  const home = mkdtempSync(join(tmpdir(), 'tron-doctor-'));
  const profile = join(home, '.tronbrowser');
  mkdirSync(join(profile, 'Default'), { recursive: true });
  const bin = join(home, 'bin');
  mkdirSync(bin);
  const engine = join(bin, 'ungoogled-chromium');
  writeFileSync(engine, `#!/bin/sh\necho "${engineVersion}"\n`, { mode: 0o755 });
  return { home, profile, engine };
}

function run(env: Env, args: string[] = []): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('python3', [DOCTOR, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: env.home,
      TRONBROWSER_DATA: env.profile,
      TRONBROWSER_BROWSER: env.engine,
    },
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? -1 };
}

function report(env: Env): { problems: { code: string; text: string }[]; [k: string]: unknown } {
  const { stdout, status } = run(env, ['doctor', '--json']);
  expect([0, 1]).toContain(status);
  return JSON.parse(stdout);
}

const codes = (env: Env) => report(env).problems.map((p) => p.code);

/** Write a real SQLite file with Chromium's meta table, the way the engine would. */
function sqliteDb(path: string, version = 140): void {
  const result = spawnSync(
    'python3',
    [
      '-c',
      [
        'import sqlite3, sys',
        'c = sqlite3.connect(sys.argv[1])',
        "c.execute('CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR)')",
        "c.execute('INSERT INTO meta VALUES(?, ?)', ('version', sys.argv[2]))",
        'c.commit(); c.close()',
      ].join('\n'),
      path,
      String(version),
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr);
}

const lastVersion = (env: Env, v: string) => writeFileSync(join(env.profile, 'Last Version'), `${v}\n`);

const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children) c.kill();
  children.length = 0;
});

describe('tron doctor', () => {
  it('finds nothing wrong with a healthy profile', () => {
    const env = setup();
    sqliteDb(join(env.profile, 'Default', 'Web Data'));
    sqliteDb(join(env.profile, 'Default', 'History'));
    lastVersion(env, '151.0.7922.173');
    const { stdout, status } = run(env, ['doctor']);
    expect(status).toBe(0);
    expect(stdout).toContain('No problems found');
    expect(stdout).toContain('Web Data');
    expect(stdout).toContain('schema 140');
  });

  it('reports the engine as the cause when the profile was written by a newer build', () => {
    // The case this exists for: the Flatpak updated itself, then a distro
    // package (or a rollback) put an older build in front of it.
    const env = setup('Chromium 151.0.7922.173');
    sqliteDb(join(env.profile, 'Default', 'Web Data'));
    lastVersion(env, '152.0.7977.82');
    const r = report(env);
    expect(r.problems.map((p) => p.code)).toEqual(['engine-downgrade']);
    expect(r.problems[0]!.text).toContain('152.0.7977.82');
    expect(r.problems[0]!.text).toContain('OLDER');
  });

  it('does not call a same-version engine a downgrade, whatever the build suffix', () => {
    const env = setup('Chromium 152.0.7977.82');
    lastVersion(env, '152.0.7977.82');
    expect(codes(env)).toEqual([]);
  });

  it('reports a database that is not a database, and says what it holds', () => {
    const env = setup();
    writeFileSync(join(env.profile, 'Default', 'Web Data'), 'this is not a database\n');
    const r = report(env);
    const p = r.problems.find((x) => x.code === 'db-corrupt');
    expect(p).toBeDefined();
    expect(p!.text).toContain('Web Data');
    expect(p!.text).toContain('autofill');
  });

  it('reports a lock left behind by a killed instance', () => {
    const env = setup();
    symlinkSync('somehost-2147483000', join(env.profile, 'SingletonLock'));
    const found = codes(env);
    expect(found.length).toBe(1);
    expect(['lock-stale', 'lock-other-host']).toContain(found[0]);
  });

  it('surfaces the database lines from the engine log and nothing else', () => {
    const env = setup();
    writeFileSync(
      join(env.profile, 'tron.log'),
      [
        '[1:1:0913/101010.000:ERROR:sql/database.cc] Web Data sqlite error 26: file is not a database',
        '[1:1:0913/101010.001:ERROR:mojo] widget host noise',
        '',
      ].join('\n'),
    );
    const { stdout } = run(env, ['doctor']);
    expect(stdout).toContain('file is not a database');
    expect(stdout).not.toContain('widget host noise');
  });

  it('rejects a mode it does not know', () => {
    const env = setup();
    expect(run(env, ['bogus']).status).toBe(2);
  });
});

describe('tron repair', () => {
  it('moves a broken database aside rather than deleting it, and removes the stale lock', () => {
    const env = setup();
    writeFileSync(join(env.profile, 'Default', 'Web Data'), 'garbage');
    writeFileSync(join(env.profile, 'Default', 'Web Data-journal'), 'garbage');
    sqliteDb(join(env.profile, 'Default', 'History'));
    symlinkSync('somehost-2147483000', join(env.profile, 'SingletonLock'));

    const { stdout, status } = run(env, ['repair']);
    expect(status).toBe(0);
    expect(stdout).toContain('SingletonLock');
    expect(stdout).toContain('Web Data');

    expect(existsSync(join(env.profile, 'SingletonLock'))).toBe(false);
    expect(existsSync(join(env.profile, 'Default', 'Web Data'))).toBe(false);
    expect(existsSync(join(env.profile, 'Default', 'History'))).toBe(true);
    const backup = readdirSync(env.profile).find((f) => f.startsWith('tron-repair-'));
    expect(backup).toBeDefined();
    expect(readdirSync(join(env.profile, backup!)).sort()).toEqual(['Web Data', 'Web Data-journal']);

    expect(codes(env)).toEqual([]);
  });

  it('touches nothing on a dry run', () => {
    const env = setup();
    writeFileSync(join(env.profile, 'Default', 'Web Data'), 'garbage');
    const { stdout, status } = run(env, ['repair', '--dry-run']);
    expect(status).toBe(0);
    expect(stdout).toContain('Would move Web Data');
    expect(existsSync(join(env.profile, 'Default', 'Web Data'))).toBe(true);
    expect(readdirSync(env.profile).some((f) => f.startsWith('tron-repair-'))).toBe(false);
  });

  it('refuses while a browser has the profile open', async () => {
    const env = setup();
    writeFileSync(join(env.profile, 'Default', 'Web Data'), 'garbage');
    // Anything with the profile's --user-data-dir on its command line is the
    // browser as far as the process list is concerned.
    const child = spawn('python3', ['-c', 'import time; time.sleep(30)', `--user-data-dir=${env.profile}`]);
    children.push(child);
    await new Promise((r) => setTimeout(r, 300));

    const { stderr, status } = run(env, ['repair']);
    expect(status).toBe(1);
    expect(stderr).toContain('running');
    expect(existsSync(join(env.profile, 'Default', 'Web Data'))).toBe(true);
  });

  it('has nothing to do for a downgrade, and says what to do instead', () => {
    const env = setup('Chromium 141.0.0.0');
    lastVersion(env, '152.0.7977.82');
    const { stdout, status } = run(env, ['repair']);
    expect(status).toBe(1);
    expect(stdout).toContain('Nothing for repair to do');
    expect(stdout).toContain('OLDER');
  });
});

// --- macOS: which Chromium.app will run -------------------------------------
// On macOS TronBrowser has no engine of its own — it drives a Chromium.app
// found on disk — so "no app" means `tron` never opens a window at all. The
// state worth naming is the quiet one: Homebrew reports the cask installed
// while the app it points at is gone, and nothing says so until the next
// launch. Only meaningful on macOS; the check is a no-op elsewhere.
//
// The Caskroom under test is reached through brew's own prefix (a stub `brew`
// on PATH), and TRONBROWSER_MAC_SEARCH_ROOT aims the machine-wide paths —
// /Applications and the default Caskrooms — at an empty fixture dir, so the
// host's own Chromium.app cannot decide the outcome.
const onMac = process.platform === 'darwin';

/** A Caskroom whose Chromium.app symlink points at `target` (gone, if absent). */
function caskroom(env: Env, version: string, target?: string): string {
  const brewBin = join(env.home, 'brewprefix', 'bin');
  mkdirSync(brewBin, { recursive: true });
  writeFileSync(join(brewBin, 'brew'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const room = join(env.home, 'brewprefix', 'Caskroom', 'ungoogled-chromium', version);
  mkdirSync(room, { recursive: true });
  const link = join(room, 'Chromium.app');
  symlinkSync(target ?? join(env.home, 'deleted', 'Chromium.app'), link);
  return link;
}

/** Report with no TRONBROWSER_BROWSER override, so discovery actually runs. */
function discoveredReport(env: Env): { problems: { code: string; text: string; hint: string }[] } {
  const result = spawnSync('python3', [DOCTOR, 'doctor', '--json'], {
    encoding: 'utf8',
    env: {
      PATH: `${join(env.home, 'brewprefix', 'bin')}:/usr/bin:/bin`,
      HOME: env.home,
      TRONBROWSER_DATA: env.profile,
      TRONBROWSER_MAC_SEARCH_ROOT: join(env.home, 'root'),
    },
  });
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout ?? '{}');
}

describe.skipIf(!onMac)('macOS browser discovery', () => {
  it('names a cask whose app was deleted, and does not suggest install --force', () => {
    // `brew install --cask --force` is a no-op while the install receipt is
    // intact, so it can be re-run forever with the app still missing.
    const env = setup();
    caskroom(env, '154.0.8037.97-1.1');
    const stale = discoveredReport(env).problems.find((p) => p.code === 'cask-app-missing');
    expect(stale).toBeDefined();
    expect(stale!.hint).toBe('brew reinstall --cask ungoogled-chromium');
    expect(stale!.text).toContain('keeps saying installed');
  });

  it('runs the cask app the launcher would, reached through brew\'s prefix', () => {
    const env = setup();
    const real = join(env.home, 'appdir', 'Chromium.app');
    mkdirSync(join(real, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(real, 'Contents', 'MacOS', 'Chromium'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(
      join(real, 'Contents', 'Info.plist'),
      '<?xml version="1.0"?><!DOCTYPE plist><plist version="1.0"><dict>' +
        '<key>CFBundleShortVersionString</key><string>154.0.8037.97</string></dict></plist>',
    );
    const link = caskroom(env, '154.0.8037.97-1.1', real);
    const rep = discoveredReport(env) as { problems: { code: string }[]; engine?: { source: string; version: string } };
    expect(rep.problems.map((p) => p.code)).not.toContain('no-macos-app');
    expect(rep.engine?.source).toBe(link);
    // Read from Info.plist, never by running the binary: launched from a shell
    // rather than through LaunchServices, Chromium SIGABRTs.
    expect(rep.engine?.version).toBe('154.0.8037.97');
  });

  it('suggests brew, not Flatpak, when nothing is installed', () => {
    const env = setup();
    const problems = discoveredReport(env).problems;
    expect(problems.map((p) => p.code)).toContain('no-macos-app');
    for (const p of problems) {
      expect(p.hint).toContain('brew');
      expect(p.hint).not.toContain('flatpak');
    }
  });

  it('stays quiet about app bundles when TRONBROWSER_BROWSER is set', () => {
    // An explicit override IS the engine; /Applications is irrelevant then.
    const env = setup();
    caskroom(env, '154.0.8037.97-1.1');
    expect(codes(env)).not.toContain('cask-app-missing');
    expect(codes(env)).not.toContain('no-macos-app');
  });
});
