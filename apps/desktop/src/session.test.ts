// Integration tests for the managed-session engine (apps/desktop/launcher/
// tron-session), driven through its real CLI against a Node CDP mock. This is
// the regression coverage for the *running* implementation; the pure schema /
// tab-mapping contract it mirrors is unit-tested in @tronbrowser/browser-core.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SESSION = fileURLToPath(new URL('../launcher/tron-session', import.meta.url));
const SHIM = fileURLToPath(new URL('../test/fixtures/fake-shim.sh', import.meta.url));

// The engine shells out to curl + python3 (already launcher dependencies). Skip
// the suite gracefully where they are unavailable rather than fail spuriously.
function has(bin: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).status === 0;
}
const ready = has('curl') && (has('python3') || has('python'));

let dataDir: string;

function baseEnv(): NodeJS.ProcessEnv {
  return { ...process.env, TRONBROWSER_DATA: dataDir, TRONBROWSER_SHIM: SHIM };
}

/** Run a tron-session command, returning stdout (throws on nonzero exit). */
function tron(...args: string[]): string {
  return execFileSync(SESSION, args, { env: baseEnv(), encoding: 'utf8', timeout: 30_000 });
}

/** Run and capture status + stdout without throwing (for exit-code assertions). */
function tronStatus(...args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync(SESSION, args, { env: baseEnv(), encoding: 'utf8', timeout: 30_000 });
  return { status: r.status, stdout: r.stdout ?? '' };
}

describe.skipIf(!ready)('tron-session managed sessions', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'tron-session-test-'));
  });

  afterEach(() => {
    try {
      tron('browser', 'close');
    } catch {
      // ignore — individual tests close their own session
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('launches a session and writes a live descriptor', () => {
    const out = tron('browser', 'launch');
    expect(out).toMatch(/managed session ready on 127\.0\.0\.1:\d+/);

    const desc = JSON.parse(tron('browser', 'status', '--json'));
    expect(desc.state).toBe('running');
    expect(desc.version).toBe(1);
    expect(desc.host).toBe('127.0.0.1');
    expect(desc.port).toBeGreaterThan(0);
    expect(desc.profileName).toBe('agent');
    expect(desc.headless).toBe(false);
    // The M3.2 attach point must be captured.
    expect(desc.webSocketDebuggerUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\//);

    expect(tron('browser', 'status')).toMatch(/running/);
  });

  it('lists the initial tab and marks it current', () => {
    tron('browser', 'launch');
    const tabs = JSON.parse(tron('browser', 'tabs', '--json'));
    expect(tabs).toHaveLength(1);
    expect(tabs[0].current).toBe(true);
    expect(tabs[0].url).toBe('chrome://newtab/');
  });

  it('opens a URL as a new current tab', () => {
    tron('browser', 'launch');
    const out = tron('open', 'http://example.com/contact');
    expect(out).toMatch(/opened http:\/\/example\.com\/contact/);

    const tabs = JSON.parse(tron('browser', 'tabs', '--json'));
    expect(tabs).toHaveLength(2);
    const current = tabs.find((t: { current: boolean }) => t.current);
    expect(current.url).toBe('http://example.com/contact');
  });

  it('switches the current tab with use, reflected by current', () => {
    tron('browser', 'launch');
    tron('open', 'http://example.org');
    const tabs = JSON.parse(tron('browser', 'tabs', '--json'));
    const first = tabs[0].id as string;

    tron('browser', 'use', first);
    const after = JSON.parse(tron('browser', 'tabs', '--json'));
    expect(after.find((t: { current: boolean }) => t.current).id).toBe(first);
    expect(tron('browser', 'current')).toContain(first);
  });

  it('rejects a launch while one is already running', () => {
    tron('browser', 'launch');
    expect(tron('browser', 'launch')).toMatch(/already running/);
  });

  it('uses an ephemeral temp profile for headless and removes it on close', () => {
    tron('browser', 'launch', '--headless');
    const desc = JSON.parse(tron('browser', 'status', '--json'));
    expect(desc.headless).toBe(true);
    expect(desc.ephemeral).toBe(true);
    expect(desc.profileName).toBe('ephemeral');
    expect(desc.profileDir.startsWith(tmpdir())).toBe(true);
    expect(existsSync(desc.profileDir)).toBe(true);

    tron('browser', 'close');
    expect(existsSync(desc.profileDir)).toBe(false);
    expect(tron('browser', 'status')).toMatch(/no managed session/);
  });

  it('closes cleanly and reports no session afterwards', () => {
    tron('browser', 'launch');
    expect(tron('browser', 'close')).toMatch(/closed managed session/);
    expect(tron('browser', 'status')).toMatch(/no managed session/);
  });

  it('exits 3 from `open` when no session is running (legacy-launch signal)', () => {
    const r = tronStatus('open', 'http://fallback.test');
    expect(r.status).toBe(3);
  });
});
