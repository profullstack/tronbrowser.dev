// `tron automate` routes to sdk/automate-bin.js with the Obscura binary the
// installer put next to the launcher. It lives inside install.sh's `<<'TRON'`
// heredoc, so `sh -n install.sh` never parses it — these tests extract the
// generated CLI and run it against a fake install tree.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALL_SH = join(HERE, '..', 'public', 'install.sh');

const roots: string[] = [];
let cli = '';
let installSrc = '';

beforeAll(() => {
  installSrc = readFileSync(INSTALL_SH, 'utf8');
  const start = installSrc.indexOf("<<'TRON'\n");
  const end = installSrc.indexOf('\nTRON\n', start);
  expect(start, 'CLI heredoc not found in install.sh').toBeGreaterThan(-1);
  expect(end, 'CLI heredoc has no terminator').toBeGreaterThan(start);
  const body = installSrc.slice(start + "<<'TRON'\n".length, end);

  const dir = mkdtempSync(join(tmpdir(), 'tron-cli-'));
  roots.push(dir);
  cli = join(dir, 'tron');
  writeFileSync(cli, body, { mode: 0o755 });
  expect(spawnSync('sh', ['-n', cli], { encoding: 'utf8' }).status, 'generated CLI is not valid sh').toBe(0);
  expect(spawnSync('sh', ['-n', INSTALL_SH], { encoding: 'utf8' }).status, 'install.sh is not valid sh').toBe(0);
});

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A fake install: launcher dir with a `tronbrowser` shim, `current` symlink, and a fake node that prints its argv + env. */
function install(opts: { automateBin?: boolean; obscura?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'tron-home-'));
  roots.push(home);
  const app = join(home, '.local', 'lib', 'tronbrowser');
  const launcher = join(app, 'v1', 'tronbrowser');
  mkdirSync(launcher, { recursive: true });
  writeFileSync(join(launcher, 'tronbrowser'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(launcher, 'tron-session'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(launcher, 'tron-node.mjs'), '');
  if (opts.automateBin !== false) {
    mkdirSync(join(launcher, 'sdk'), { recursive: true });
    writeFileSync(join(launcher, 'sdk', 'automate-bin.js'), '');
  }
  if (opts.obscura) {
    mkdirSync(join(launcher, 'obscura-bin'), { recursive: true });
    writeFileSync(join(launcher, 'obscura-bin', 'obscura'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  symlinkSync(join(launcher, 'tronbrowser'), join(app, 'current'));

  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'node'), '#!/bin/sh\necho "node argv: $*"\necho "TRON_OBSCURA_BIN=$TRON_OBSCURA_BIN"\necho "TRON_SESSION_BIN=$TRON_SESSION_BIN"\n', { mode: 0o755 });
  return { home, launcher, bin };
}

function tron(home: string, path: string, args: string[]) {
  const r = spawnSync('sh', [cli, ...args], {
    encoding: 'utf8',
    env: { PATH: `${path}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: home, TRONBROWSER_AUTO_UPGRADE: '0' },
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

describe('tron automate', () => {
  it('is in the help text', () => {
    const r = spawnSync('sh', [cli, 'help'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/nonexistent' } });
    expect(r.stdout).toContain('tron automate');
    expect(r.stdout).toContain('tron automate serve');
    expect(r.stdout).toContain('tron automate fetch <url>');
  });

  it('runs sdk/automate-bin.js through tron-node.mjs with the installed Obscura', () => {
    const { home, launcher, bin } = install({ obscura: true });
    const r = tron(home, bin, ['automate', 'fetch', 'https://example.com/', '--format', 'text']);
    expect(r.status).toBe(0);
    expect(r.out).toContain(`node argv: ${join(launcher, 'tron-node.mjs')} ${join(launcher, 'sdk', 'automate-bin.js')} fetch https://example.com/ --format text`);
    expect(r.out).toContain(`TRON_OBSCURA_BIN=${join(launcher, 'obscura-bin', 'obscura')}`);
    expect(r.out).toContain(`TRON_SESSION_BIN=${join(launcher, 'tron-session')}`);
    expect(r.err).not.toContain('Obscura is not installed');
  });

  it('warns once when Obscura is missing and still runs (Chromium does every page)', () => {
    const { home, bin } = install({ obscura: false });
    const r = tron(home, bin, ['automate']);
    expect(r.status).toBe(0);
    expect(r.err).toContain('Obscura is not installed');
    expect(r.err).toContain('ensure-obscura');
    expect(r.out).toContain('automate-bin.js');
    // status is the command that reports the gap itself; no nagging there.
    expect(tron(home, bin, ['automate', 'status']).err).not.toContain('Obscura is not installed');
  });

  it('explains what to do when the build predates the automate runtime', () => {
    const { home, bin } = install({ automateBin: false });
    const r = tron(home, bin, ['automate']);
    expect(r.status).toBe(1);
    expect(r.err).toContain('tron upgrade');
  });
});

describe('installer Obscura setup', () => {
  it('has an ensure-obscura command, pins a version, and hooks install and upgrade', () => {
    expect(installSrc).toMatch(/^\s+ensure-obscura\) ensure_obscura ;;/m);
    expect(installSrc).toMatch(/OBSCURA_VERSION="\$\{TRONBROWSER_OBSCURA_VERSION:-\d+\.\d+\.\d+\}"/);
    expect(installSrc).toContain('https://github.com/h4ckf0r0day/obscura/releases/download/v${OBSCURA_VERSION}/${asset}');
    // Both paths that put files on disk keep the engine current; both tolerate a miss.
    expect(installSrc.match(/ensure_obscura\s+\|\| true/g)?.length).toBe(2);
    expect(installSrc).toContain('TB_NO_OBSCURA_INSTALL');
  });
});
