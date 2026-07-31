import { describe, expect, it, vi } from 'vitest';
import { EXIT, run, type CliDeps } from './automate-cli.js';
import type { CdpConnection } from './automation/cdp-client.js';
import type { SessionDescriptor } from './automation/types.js';

const descriptor: SessionDescriptor = {
  version: 1, pid: 1, host: '127.0.0.1', port: 9222, profileDir: '/x',
  profileName: 'agent', headless: false, ephemeral: false,
  createdAt: '2026-07-04T00:00:00.000Z', activeTabId: 'p1',
};

/** Fake connection with per-method canned results; simulates page load on navigate. */
function connWith(handlers: Record<string, unknown>): CdpConnection {
  const evs: Record<string, (p: unknown) => void> = {};
  return {
    send: (async (method: string) => {
      if (method === 'Page.navigate') {
        queueMicrotask(() => evs['Page.loadEventFired']?.({}));
        return {};
      }
      return handlers[method] ?? {};
    }) as CdpConnection['send'],
    on: (m: string, h: (p: unknown) => void) => {
      evs[m] = h;
    },
    close: vi.fn(),
  };
}

function harness(handlers: Record<string, unknown>, overrides: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const writes: Array<{ path: string; bytes: Uint8Array }> = [];
  const calls: string[] = [];
  const deps: Partial<CliDeps> = {
    env: {},
    loadDescriptor: async () => descriptor,
    fetchTargets: async () => [
      { id: 'p1', type: 'page', url: 'https://example.com', webSocketDebuggerUrl: 'ws://x/p1' },
    ],
    connect: async () => connWith(handlers),
    launchHeadless: async () => {
      calls.push('launch');
    },
    closeSession: async () => {
      calls.push('close');
    },
    writeBytes: async (path, bytes) => {
      writes.push({ path, bytes });
    },
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    ...overrides,
  };
  return { deps, out, err, writes, calls };
}

const evalResult = (value: unknown) => ({ 'Runtime.evaluate': { result: { value } } });
const png = { 'Page.captureScreenshot': { data: Buffer.from('PNGDATA').toString('base64') } };
const pdf = { 'Page.printToPDF': { data: Buffer.from('PDFDATA').toString('base64') } };

describe('extract command', () => {
  it('prints extraction JSON', async () => {
    const { deps, out } = harness(evalResult([{ text: 'A', href: 'https://x/a' }]));
    const code = await run(['extract', 'links'], deps);
    expect(code).toBe(EXIT.ok);
    expect(JSON.parse(out.join('\n'))).toEqual([{ text: 'A', href: 'https://x/a' }]);
  });

  it('rejects missing target', async () => {
    const { deps } = harness({});
    expect(await run(['extract'], deps)).toBe(EXIT.usage);
  });
});

describe('screenshot / pdf commands', () => {
  it('writes a screenshot to the given path', async () => {
    const { deps, writes, out } = harness(png);
    const code = await run(['screenshot', 'shot.png'], deps);
    expect(code).toBe(EXIT.ok);
    expect(writes[0].path).toBe('shot.png');
    expect(Buffer.from(writes[0].bytes).toString()).toBe('PNGDATA');
    expect(out.join('\n')).toContain('screenshot -> shot.png');
  });

  it('writes a pdf', async () => {
    const { deps, writes } = harness(pdf);
    expect(await run(['pdf', 'out.pdf'], deps)).toBe(EXIT.ok);
    expect(Buffer.from(writes[0].bytes).toString()).toBe('PDFDATA');
  });

  it('rejects screenshot without a path', async () => {
    const { deps } = harness({});
    expect(await run(['screenshot'], deps)).toBe(EXIT.usage);
  });
});

describe('headless one-shot', () => {
  it('launches, navigates, snapshots, and always closes', async () => {
    const snap = { url: 'u', title: 'T', timestamp: 't', elements: [] };
    const { deps, out, calls } = harness(evalResult(snap));
    const code = await run(['headless', 'https://example.com', '--snapshot', '--json'], deps);
    expect(code).toBe(EXIT.ok);
    expect(calls).toEqual(['launch', 'close']);
    expect(JSON.parse(out.join('\n')).title).toBe('T');
  });

  it('captures a screenshot in headless mode', async () => {
    const { deps, writes, calls } = harness(png);
    const code = await run(['headless', 'https://example.com', '--screenshot', 'h.png'], deps);
    expect(code).toBe(EXIT.ok);
    expect(writes[0].path).toBe('h.png');
    expect(calls).toContain('close');
  });

  it('closes the session even when the op fails', async () => {
    const { deps, calls } = harness(png, {
      writeBytes: async () => {
        throw new Error('disk full');
      },
    });
    const code = await run(['headless', 'https://example.com', '--screenshot', 'h.png'], deps);
    expect(code).toBe(EXIT.failed);
    expect(calls).toEqual(['launch', 'close']); // cleanup still ran
  });

  it('rejects headless without a url', async () => {
    const { deps } = harness({});
    expect(await run(['headless'], deps)).toBe(EXIT.usage);
  });
});
