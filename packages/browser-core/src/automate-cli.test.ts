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
