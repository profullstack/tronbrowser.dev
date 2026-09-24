import { describe, expect, it, vi } from 'vitest';
import { EXIT, run, type CliDeps } from './automate-cli.js';
import type { CdpConnection } from './automation/cdp-client.js';
import type { AgentSnapshot } from './automation/snapshot-script.js';
import type { SessionDescriptor } from './automation/types.js';

const descriptor: SessionDescriptor = {
  version: 1,
  pid: 1,
  host: '127.0.0.1',
  port: 9222,
  profileDir: '/x',
  profileName: 'agent',
  headless: false,
  ephemeral: false,
  createdAt: '2026-07-04T00:00:00.000Z',
  activeTabId: 'p1',
};

const snap: AgentSnapshot = {
  url: 'https://example.com',
  title: 'Example',
  timestamp: '2026-07-04T00:00:00.000Z',
  elements: [
    { ref: '@e1', role: 'link', name: 'More', tag: 'a', interactive: true, visible: true, href: 'https://x' },
  ],
};

/** A CdpConnection whose Runtime.evaluate yields `evalValue`. */
function conn(evalValue: unknown): CdpConnection {
  return {
    send: (async (method: string) =>
      method === 'Runtime.evaluate' ? { result: { value: evalValue } } : {}) as CdpConnection['send'],
    on: vi.fn(),
    close: vi.fn(),
  };
}

function harness(overrides: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: Partial<CliDeps> = {
    env: {},
    loadDescriptor: async () => descriptor,
    fetchTargets: async () => [
      { id: 'p1', type: 'page', url: 'https://example.com', webSocketDebuggerUrl: 'ws://x/p1' },
    ],
    connect: async () => conn(snap),
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    ...overrides,
  };
  return { deps, out, err };
}

describe('automate-cli run', () => {
  it('prints a text snapshot', async () => {
    const { deps, out } = harness();
    const code = await run(['snapshot'], deps);
    expect(code).toBe(EXIT.ok);
    expect(out.join('\n')).toContain('@e1 link "More"');
  });

  it('prints JSON with --json', async () => {
    const { deps, out } = harness();
    await run(['snapshot', '--json'], deps);
    expect(JSON.parse(out.join('\n')).title).toBe('Example');
  });

  it('clicks a ref', async () => {
    const { deps, out } = harness({ connect: async () => conn({ ok: true, ref: '@e1' }) });
    const code = await run(['click', '@e1'], deps);
    expect(code).toBe(EXIT.ok);
    expect(out.join('\n')).toContain('clicked @e1');
  });

  it('fills a ref', async () => {
    const { deps, out } = harness({ connect: async () => conn({ ok: true, ref: '@e2' }) });
    const code = await run(['fill', '@e2', 'hello'], deps);
    expect(code).toBe(EXIT.ok);
    expect(out.join('\n')).toContain('filled @e2');
  });

  it('uploads files to a file input by object id', async () => {
    const sent: Array<[string, unknown]> = [];
    const c: CdpConnection = {
      send: (async (method: string, params: unknown) => {
        sent.push([method, params]);
        if (method === 'Runtime.evaluate') return { result: { objectId: 'obj-1' } };
        if (method === 'Runtime.callFunctionOn') return { result: { value: true } };
        return {};
      }) as CdpConnection['send'],
      on: vi.fn(),
      close: vi.fn(),
    };
    const { deps, out } = harness({ connect: async () => c });
    const code = await run(['upload', '@e7', '/tmp/cv.pdf'], deps);
    expect(code).toBe(EXIT.ok);
    expect(sent).toContainEqual(['DOM.setFileInputFiles', { objectId: 'obj-1', files: ['/tmp/cv.pdf'] }]);
    expect(out.join('\n')).toContain('uploaded 1 file(s) to @e7');
  });

  it('presses keys with trusted input events', async () => {
    const sent: Array<[string, unknown]> = [];
    const c: CdpConnection = {
      send: (async (method: string, params: unknown) => { sent.push([method, params]); return {}; }) as CdpConnection['send'],
      on: vi.fn(),
      close: vi.fn(),
    };
    const { deps } = harness({ connect: async () => c });
    expect(await run(['press', 'Enter'], deps)).toBe(EXIT.ok);
    const keys = sent.filter(([m]) => m === 'Input.dispatchKeyEvent').map(([, p]) => (p as { type: string; key: string }).type + ':' + (p as { key: string }).key);
    expect(keys).toEqual(['keyDown:Enter', 'keyUp:Enter']);
  });

  it('selects a native option by label', async () => {
    const { deps, out } = harness({ connect: async () => conn({ ok: true, chosen: 'United States' }) });
    expect(await run(['select', '@e3', 'united states'], deps)).toBe(EXIT.ok);
    expect(out.join('\n')).toContain('selected "United States" in @e3');
  });

  it('prints usage for upload/select/press without arguments', async () => {
    for (const cmd of ['upload', 'select', 'press']) {
      const { deps, err } = harness();
      expect(await run([cmd], deps)).toBe(EXIT.usage);
      expect(err.join('\n')).toContain(`tron ${cmd}`);
    }
  });

  it('exits staleRef when a ref no longer resolves', async () => {
    const { deps, err } = harness({
      connect: async () => conn({ ok: false, error: 'STALE_REF', ref: '@e9' }),
    });
    const code = await run(['click', '@e9'], deps);
    expect(code).toBe(EXIT.staleRef);
    expect(err.join('\n')).toMatch(/stale/i);
  });

  it('exits noSession when there is no descriptor', async () => {
    const { deps, err } = harness({
      loadDescriptor: async () => {
        throw new Error('ENOENT');
      },
    });
    const code = await run(['snapshot'], deps);
    expect(code).toBe(EXIT.noSession);
    expect(err.join('\n')).toContain('tron browser launch');
  });

  it('exits usage when click is missing a ref', async () => {
    const { deps } = harness();
    expect(await run(['click'], deps)).toBe(EXIT.usage);
  });
});
