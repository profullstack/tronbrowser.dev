import { describe, expect, it, vi } from 'vitest';
import type { CdpConnection, CdpTarget, SessionDescriptor } from '@tronbrowser/browser-core';
import { tron } from './index.js';
import type { SdkDeps } from './deps.js';

const descriptor: SessionDescriptor = {
  version: 1, pid: 1, host: '127.0.0.1', port: 9222, profileDir: '/x',
  profileName: 'ephemeral', headless: true, ephemeral: true,
  createdAt: '2026-07-04T00:00:00.000Z', activeTabId: 'p1',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/b',
};

/** Fake CDP connection: canned Runtime.evaluate value; simulates navigate load. */
function fakeConn(evalValue: unknown, methods: Record<string, unknown> = {}): CdpConnection {
  const evs: Record<string, (p: unknown) => void> = {};
  return {
    send: (async (method: string) => {
      if (method === 'Page.navigate') {
        queueMicrotask(() => evs['Page.loadEventFired']?.({}));
        return {};
      }
      if (method === 'Runtime.evaluate') return { result: { value: evalValue } };
      return methods[method] ?? {};
    }) as CdpConnection['send'],
    on: (m: string, h: (p: unknown) => void) => {
      evs[m] = h;
    },
    close: vi.fn(),
  };
}

function fakeDeps(conn: CdpConnection, overrides: Partial<SdkDeps> = {}) {
  const calls: string[] = [];
  const targets: CdpTarget[] = [
    { id: 'p1', type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://x/p1' },
  ];
  const deps: SdkDeps = {
    makeDataDir: async () => '/tmp/sdk-test',
    removeDataDir: async () => {
      calls.push('rm');
    },
    launchSession: async (_d, a) => {
      calls.push(`launch:${a.headless ? 'headless' : 'headed'}:${a.profile ?? '-'}`);
    },
    closeSession: async () => {
      calls.push('close');
    },
    loadDescriptor: async () => descriptor,
    fetchTargets: async () => targets,
    connect: async () => conn,
    writeBytes: async () => {},
    ...overrides,
  };
  return { deps, calls };
}

describe('tron.launch lifecycle', () => {
  it('launches headless, opens a page, and snapshots', async () => {
    const snap = { url: 'u', title: 'T', timestamp: 't', elements: [] };
    const { deps, calls } = fakeDeps(fakeConn(snap));
    const browser = await tron.launch({ headless: true }, deps);
    expect(calls[0]).toBe('launch:headless:-');
    const page = await browser.newPage();
    await page.goto('https://example.com');
    expect((await page.snapshot()).title).toBe('T');
    await browser.close();
    expect(calls).toContain('close');
    expect(calls).toContain('rm');
  });

  it('passes a named profile through to the session engine', async () => {
    const { deps, calls } = fakeDeps(fakeConn(null));
    const browser = await tron.launch({ profile: 'work' }, deps);
    expect(calls[0]).toBe('launch:headed:work');
    await browser.close();
  });

  it('tears down the session if launch fails', async () => {
    const { deps, calls } = fakeDeps(fakeConn(null), {
      loadDescriptor: async () => {
        throw new Error('never came up');
      },
    });
    await expect(tron.launch({}, deps)).rejects.toThrow(/never came up/);
    expect(calls).toContain('close');
    expect(calls).toContain('rm');
  });

  it('extracts and reads url/title via the page', async () => {
    const { deps } = fakeDeps(fakeConn([{ text: 'A', href: 'https://x/a' }]));
    const browser = await tron.launch({}, deps);
    const page = await browser.newPage();
    expect(await page.extract('links')).toEqual([{ text: 'A', href: 'https://x/a' }]);
    await browser.close();
  });

  it('captures a screenshot through the page', async () => {
    const png = { 'Page.captureScreenshot': { data: Buffer.from('PNG').toString('base64') } };
    const { deps } = fakeDeps(fakeConn(null, png));
    const browser = await tron.launch({ headless: true }, deps);
    const page = await browser.newPage();
    const bytes = await page.screenshot();
    expect(Buffer.from(bytes).toString()).toBe('PNG');
    await browser.close();
  });

  it('surfaces analyze() as an M3.5 feature', async () => {
    const { deps } = fakeDeps(fakeConn(null));
    const browser = await tron.launch({}, deps);
    const page = await browser.newPage();
    expect(() => page.analyze()).toThrow(/M3\.5/);
    await browser.close();
  });
});
