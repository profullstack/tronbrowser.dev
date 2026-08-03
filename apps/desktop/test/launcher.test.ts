// The launcher shim decides what Chromium runs and with which flags, and it is
// the one piece of TronBrowser with no compiler and no types behind it. These
// tests run the real script against a stub browser that records its argv, so a
// change to flag handling has to survive something before it ships.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = join(HERE, '..', 'launcher', 'tronbrowser');

type Run = { argv: string[]; stderr: string; home: string };

const homes: string[] = [];

/**
 * Run the launcher with a stub browser and return the argv it was handed.
 *
 * The script is copied somewhere else first, on purpose: it resolves helpers
 * relative to its own directory, and a copy has no tron-tor-helper beside it,
 * so the background Tor helper is skipped instead of binding a port under test.
 */
function run(args: string[], opts: { version?: string; home?: string } = {}): Run {
  const home = opts.home ?? mkdtempSync(join(tmpdir(), 'tron-launcher-'));
  if (!opts.home) homes.push(home);

  const dir = join(home, 'bin');
  mkdirSync(dir, { recursive: true });
  const script = join(dir, 'tronbrowser');
  copyFileSync(LAUNCHER, script);
  chmodSync(script, 0o755);

  // Named "ungoogled-chromium" so the launcher's de-googled check stays quiet.
  const argvOut = join(home, 'argv.txt');
  const browser = join(dir, 'ungoogled-chromium');
  writeFileSync(
    browser,
    [
      '#!/bin/sh',
      `if [ "\${1:-}" = "--version" ]; then echo "${opts.version ?? 'Chromium 100.0.0.0'}"; exit 0; fi`,
      `: > "${argvOut}"`,
      `for a in "$@"; do printf '%s\\n' "$a" >> "${argvOut}"; done`,
      'exit 0',
    ].join('\n'),
    { mode: 0o755 },
  );

  // TRONBROWSER_VERBOSE keeps the launcher from routing the browser's stderr
  // into its log file, so the engine lines reach us here.
  const result = spawnSync('sh', [script, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: home,
      TRONBROWSER_BROWSER: browser,
      TRONBROWSER_DATA: join(home, 'profile'),
      TRONBROWSER_VERBOSE: '1',
    },
  });
  if (result.status !== 0) {
    throw new Error(`launcher exited ${result.status}\n${result.stderr ?? ''}`);
  }

  return {
    argv: existsSync(argvOut) ? readFileSync(argvOut, 'utf8').split('\n').filter(Boolean) : [],
    stderr: result.stderr ?? '',
    home,
  };
}

const valueOf = (argv: string[], name: string): string[] =>
  argv.filter((a) => a.startsWith(`${name}=`)).map((a) => a.slice(name.length + 1));

afterEach(() => {
  homes.length = 0;
});

describe('launcher flags', () => {
  it('passes its own profile when the caller asks for nothing', () => {
    const { argv, home } = run([]);
    expect(valueOf(argv, '--user-data-dir')).toEqual([join(home, 'profile')]);
  });

  it('lets the caller replace a switch instead of duplicating it', () => {
    // Chromium honors the FIRST --user-data-dir, so a duplicate meant the
    // caller's was ignored and the default profile opened instead.
    const { argv } = run(['--user-data-dir=/tmp/tron-scratch']);
    expect(valueOf(argv, '--user-data-dir')).toEqual(['/tmp/tron-scratch']);
  });

  it('merges --enable-features rather than dropping its own', () => {
    const { argv } = run(['--enable-features=WebGPU']);
    const enabled = valueOf(argv, '--enable-features');
    expect(enabled).toHaveLength(1);
    expect(enabled[0]!.split(',')).toEqual(expect.arrayContaining(['EnableTabMuting', 'WebGPU']));
  });

  it('merges --disable-features, keeping the Manifest V2 kill switch off', () => {
    // Dropping ours here would stop uBlock Origin (MV2) from loading.
    const { argv } = run(['--disable-features=Foo']);
    const disabled = valueOf(argv, '--disable-features');
    expect(disabled).toHaveLength(1);
    expect(disabled[0]!.split(',')).toEqual(
      expect.arrayContaining(['ExtensionManifestV2Disabled', 'Translate', 'Foo']),
    );
  });

  it('leaves URLs and other arguments alone', () => {
    const { argv } = run(['https://tronbrowser.dev', '--incognito']);
    expect(argv).toContain('https://tronbrowser.dev');
    expect(argv).toContain('--incognito');
  });
});

describe('engine reporting', () => {
  it('names the engine it is about to run', () => {
    const { stderr } = run([], { version: 'Chromium 141.0.0.0' });
    expect(stderr).toContain('TronBrowser: engine Chromium 141.0.0.0');
  });

  it('says so when the engine changed underneath it', () => {
    // The case this exists for: a Flatpak updates itself overnight and the
    // browser feels different, with nothing in TronBrowser's history to blame.
    const first = run([], { version: 'Chromium 141.0.0.0' });
    expect(first.stderr).not.toContain('CHANGED');

    const second = run([], { version: 'Chromium 149.0.0.0', home: first.home });
    expect(second.stderr).toContain('the browser engine CHANGED since your last launch');
    expect(second.stderr).toContain('was: Chromium 141.0.0.0');
    expect(second.stderr).toContain('now: Chromium 149.0.0.0');
  });

  it('stays quiet when the engine is the same as last time', () => {
    const first = run([], { version: 'Chromium 141.0.0.0' });
    const second = run([], { version: 'Chromium 141.0.0.0', home: first.home });
    expect(second.stderr).not.toContain('CHANGED');
  });
});
