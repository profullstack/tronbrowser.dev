// `tron search` sets the ADDRESS BAR's engine, which the launcher applies on the
// next start. It lives inside install.sh's `<<'TRON'` heredoc, so `sh -n
// install.sh` never parses it — these tests extract the generated CLI and run it,
// which is the only thing that checks that code at all.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALL_SH = join(HERE, '..', 'public', 'install.sh');

const roots: string[] = [];
let cli = '';

/** Pull the `tron` CLI back out of the heredoc that install.sh writes it from. */
beforeAll(() => {
  const src = readFileSync(INSTALL_SH, 'utf8');
  const start = src.indexOf("<<'TRON'\n");
  const end = src.indexOf('\nTRON\n', start);
  expect(start, 'CLI heredoc not found in install.sh').toBeGreaterThan(-1);
  expect(end, 'CLI heredoc has no terminator').toBeGreaterThan(start);
  const body = src.slice(start + "<<'TRON'\n".length, end);

  const dir = mkdtempSync(join(tmpdir(), 'tron-cli-'));
  roots.push(dir);
  cli = join(dir, 'tron');
  writeFileSync(cli, body, { mode: 0o755 });

  // It has to be a valid shell script before any behaviour matters.
  expect(spawnSync('sh', ['-n', cli], { encoding: 'utf8' }).status, 'generated CLI is not valid sh').toBe(0);
});

function home(): string {
  const h = mkdtempSync(join(tmpdir(), 'tron-search-'));
  roots.push(h);
  return h;
}

function search(h: string, args: string[] = [], env: Record<string, string> = {}) {
  const r = spawnSync('sh', [cli, 'search', ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: h,
      TRONBROWSER_AUTO_UPGRADE: '0',
      ...env,
    },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const chosen = (h: string, data?: string) => {
  const p = join(data ?? join(h, '.tronbrowser'), 'search-engine');
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : null;
};

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe('tron search', () => {
  it('reports the default when nothing has been chosen', () => {
    const h = home();
    const { status, out } = search(h);
    expect(status).toBe(0);
    expect(out).toContain('ddg');
  });

  it('records the chosen engine where the launcher looks for it', () => {
    const h = home();
    const { status, out } = search(h, ['neosearch']);
    expect(status).toBe(0);
    expect(chosen(h)).toBe('neosearch');
    expect(out).toContain('Restart TronBrowser');
  });

  it('reports the engine back once it is set', () => {
    const h = home();
    search(h, ['kagi']);
    expect(search(h).out).toContain('kagi');
  });

  it('rejects an engine the launcher cannot apply', () => {
    // Silently accepting a name the launcher will refuse means the setting
    // looks applied and then isn't.
    const h = home();
    const { status, out } = search(h, ['altavista']);
    expect(status).not.toBe(0);
    expect(out).toContain('unknown engine');
    expect(chosen(h)).toBeNull();
  });

  it('says the new-tab box is a separate setting', () => {
    // The whole reported bug was believing one dropdown governed both.
    expect(search(home()).out).toContain('new-tab');
  });

  it('respects TRONBROWSER_DATA', () => {
    const h = home();
    const alt = join(h, 'elsewhere');
    mkdirSync(alt, { recursive: true });
    search(h, ['xprivo'], { TRONBROWSER_DATA: alt });
    expect(chosen(h, alt)).toBe('xprivo');
    expect(chosen(h)).toBeNull();
  });

  it('also writes the visible profile dir when one exists (snap layout)', () => {
    const h = home();
    mkdirSync(join(h, 'TronBrowser'), { recursive: true });
    search(h, ['ddg']);
    expect(chosen(h)).toBe('ddg');
    expect(chosen(h, join(h, 'TronBrowser'))).toBe('ddg');
  });
});
