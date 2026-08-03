// install.sh's cache cleanup deletes directories out of a user's real profile,
// so it gets tested against a fake one. The rule it has to hold to: regenerable
// caches go, everything the user would miss stays.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALL_SH = join(HERE, '..', 'public', 'install.sh');

const CACHES = ['Cache', 'Code Cache', 'Service Worker'];
const KEEP = ['Bookmarks', 'Cookies', 'History', 'Login Data'];

const roots: string[] = [];

/** A profile whose three cache directories hold roughly `mb` megabytes each. */
function profile(mb: number): { home: string; data: string } {
  const home = mkdtempSync(join(tmpdir(), 'tron-clean-'));
  roots.push(home);
  const data = join(home, '.tronbrowser');
  const def = join(data, 'Default');

  for (const c of CACHES) {
    mkdirSync(join(def, c), { recursive: true });
    if (mb > 0) writeFileSync(join(def, c, 'blob'), Buffer.alloc(mb * 1024 * 1024, 1));
  }
  // The things a user would be upset to lose.
  for (const f of KEEP) writeFileSync(join(def, f), 'precious');
  mkdirSync(join(def, 'IndexedDB'), { recursive: true });
  writeFileSync(join(def, 'IndexedDB', 'data'), 'precious');

  return { home, data };
}

function clean(home: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync('sh', [INSTALL_SH, 'clean', ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`install.sh clean exited ${result.status}\n${result.stderr}\n${result.stdout}`);
  }
  return `${result.stdout}${result.stderr}`;
}

const cachesExist = (data: string) =>
  CACHES.map((c) => existsSync(join(data, 'Default', c)));

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe('install.sh clean', () => {
  it('clears the regenerable caches', () => {
    const { home, data } = profile(2);
    const out = clean(home, []);
    expect(cachesExist(data)).toEqual([false, false, false]);
    expect(out).toMatch(/Freed ~\d+MB/);
  });

  it('keeps everything the user would miss', () => {
    const { home, data } = profile(2);
    clean(home, []);
    for (const f of [...KEEP, 'IndexedDB']) {
      expect(existsSync(join(data, 'Default', f)), `${f} should survive`).toBe(true);
    }
  });

  it('leaves a small profile alone with --if-large', () => {
    // The automatic pass on upgrade. Clearing a healthy profile every update
    // would just cost everyone a re-download for nothing.
    const { home, data } = profile(1);
    clean(home, ['--if-large']);
    expect(cachesExist(data)).toEqual([true, true, true]);
  });

  it('clears past the limit with --if-large', () => {
    const { home, data } = profile(2);
    clean(home, ['--if-large'], { TRONBROWSER_CACHE_LIMIT_MB: '4' });
    expect(cachesExist(data)).toEqual([false, false, false]);
  });

  it('honors TRONBROWSER_CACHE_LIMIT_MB=0 as "never automatically"', () => {
    const { home, data } = profile(2);
    clean(home, ['--if-large'], { TRONBROWSER_CACHE_LIMIT_MB: '0' });
    expect(cachesExist(data)).toEqual([true, true, true]);
  });

  it('still clears on an explicit clean when the automatic pass is disabled', () => {
    const { home, data } = profile(2);
    clean(home, [], { TRONBROWSER_CACHE_LIMIT_MB: '0' });
    expect(cachesExist(data)).toEqual([false, false, false]);
  });

  it('does nothing when there is no profile', () => {
    const home = mkdtempSync(join(tmpdir(), 'tron-clean-empty-'));
    roots.push(home);
    expect(() => clean(home, [])).not.toThrow();
  });

  it('respects TRONBROWSER_DATA', () => {
    const { home } = profile(2);
    const alt = join(home, 'elsewhere');
    mkdirSync(join(alt, 'Default', 'Cache'), { recursive: true });
    writeFileSync(join(alt, 'Default', 'Cache', 'blob'), Buffer.alloc(2 * 1024 * 1024, 1));

    clean(home, [], { TRONBROWSER_DATA: alt });
    expect(existsSync(join(alt, 'Default', 'Cache'))).toBe(false);
    // The default location wasn't touched, because it wasn't the one named.
    expect(existsSync(join(home, '.tronbrowser', 'Default', 'Cache'))).toBe(true);
  });
});
