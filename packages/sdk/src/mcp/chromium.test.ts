import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DirectChromium, privateHostRules, resolveChromiumBin } from './chromium.js';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('resolveChromiumBin', () => {
  it('takes TRON_CHROMIUM_BIN when it exists, then an ungoogled build on PATH before others', () => {
    const d = mkdtempSync(join(tmpdir(), 'tron-chromium-'));
    dirs.push(d);
    const explicit = join(d, 'mychrome');
    writeFileSync(explicit, '');
    expect(resolveChromiumBin({ TRON_CHROMIUM_BIN: explicit, PATH: '' })).toBe(explicit);
    writeFileSync(join(d, 'chromium'), '');
    writeFileSync(join(d, 'ungoogled-chromium'), '');
    expect(resolveChromiumBin({ PATH: d })).toBe(join(d, 'ungoogled-chromium'));
    expect(resolveChromiumBin({ TRON_CHROMIUM_BIN: join(d, 'missing'), PATH: d })).toBe(join(d, 'ungoogled-chromium'));
  });
});

describe('DirectChromium.args', () => {
  it('runs headless with a throwaway profile and a kernel-picked port, and adds the guards asked for', () => {
    const plain = new DirectChromium({ bin: '/x/chrome' }).args('/tmp/p');
    expect(plain).toContain('--headless=new');
    expect(plain).toContain('--remote-debugging-port=0');
    expect(plain).toContain('--user-data-dir=/tmp/p');
    expect(plain).not.toContain('--no-sandbox');
    expect(plain.some((a) => a.startsWith('--host-resolver-rules='))).toBe(false);
    const guarded = new DirectChromium({ bin: '/x/chrome', headless: false, noSandbox: true, blockPrivate: true, extraArgs: ['--lang=en'] }).args('/tmp/p');
    expect(guarded).not.toContain('--headless=new');
    expect(guarded).toContain('--no-sandbox');
    expect(guarded).toContain('--lang=en');
    expect(guarded.find((a) => a.startsWith('--host-resolver-rules='))).toContain('MAP 169.254.* ~NOTFOUND');
  });
  it('privateHostRules covers loopback, link-local, and every RFC1918 block', () => {
    const rules = privateHostRules();
    for (const needle of ['MAP localhost ~NOTFOUND', 'MAP 127.* ~NOTFOUND', 'MAP 10.* ~NOTFOUND', 'MAP 192.168.* ~NOTFOUND', 'MAP 172.16.* ~NOTFOUND', 'MAP 172.31.* ~NOTFOUND', 'MAP *.internal ~NOTFOUND']) {
      expect(rules).toContain(needle);
    }
  });
  it('reports unavailable without a binary and refuses to open a page', async () => {
    const c = new DirectChromium({ bin: undefined });
    expect(c.available()).toBe(false);
    await expect(c.page()).rejects.toThrow(/No Chromium/);
  });
});

// The live half is opt-in: TRON_CHROMIUM_LIVE_TEST=1 on a box with a browser
// (a dev machine, the relay image). GitHub runners carry a Chrome that cannot
// start under the default sandbox, so "binary present" is not the switch.
const LIVE = process.env.TRON_CHROMIUM_LIVE_TEST === '1' ? resolveChromiumBin() : undefined;
describe.skipIf(!LIVE || !existsSync(LIVE))('DirectChromium live', () => {
  it('hands out isolated tabs, evaluates in them, closes them, and shuts down', async () => {
    const c = new DirectChromium({ bin: LIVE, noSandbox: process.getuid?.() === 0, idleMs: 0 });
    const a = await c.page();
    const b = await c.page();
    expect(c.running()).toBe(true);
    expect(c.openPages()).toBe(2);
    await a.page.goto('data:text/html,<title>A</title><main><h1>Alpha</h1></main>');
    await b.page.goto('data:text/html,<title>B</title><main><h1>Beta</h1></main>');
    expect(await a.page.title()).toBe('A');
    expect(await b.page.title()).toBe('B');
    expect(await a.page.eval<string>('document.querySelector("h1").textContent')).toBe('Alpha');
    await a.close();
    await a.close(); // idempotent
    expect(c.openPages()).toBe(1);
    await b.close();
    expect(c.openPages()).toBe(0);
    await c.close();
    expect(c.running()).toBe(false);
  }, 30_000);
});
