import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT, run, type CliDeps } from './automate-cli.js';
import { readCommands } from './automation/trace.js';
import type { CdpConnection } from './automation/cdp-client.js';

// Fake conn: Runtime.evaluate returns {ok:true} — good enough for clickRef/fillRef
// and for the trace's post-command snapshot capture (shape is not asserted here).
function conn(hooks: { onEval?: (expr: string) => void } = {}): CdpConnection {
  return {
    send: (async (method: string, params?: { expression?: string }) => {
      if (method === 'Runtime.evaluate') {
        hooks.onEval?.(params?.expression ?? '');
        return { result: { value: { ok: true, ref: '@e1' } } };
      }
      return {};
    }) as CdpConnection['send'],
    on: vi.fn(),
    close: vi.fn(),
  };
}

let dataDir: string;
let bundle: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cli-trace-'));
  bundle = join(dataDir, 'run.trontrace');
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

function harness(evalHook?: (expr: string) => void) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: Partial<CliDeps> = {
    env: { TRONBROWSER_DATA: dataDir },
    loadDescriptor: async () => ({
      version: 1, pid: 1, host: '127.0.0.1', port: 9222, profileDir: '/x',
      profileName: 'agent', headless: false, ephemeral: false, createdAt: 't', activeTabId: 'p1',
    }),
    fetchTargets: async () => [{ id: 'p1', type: 'page', webSocketDebuggerUrl: 'ws://x/p1' }],
    connect: async () => conn(evalHook ? { onEval: evalHook } : {}),
    out: (t) => out.push(t),
    err: (t) => err.push(t),
  };
  return { deps, out, err };
}

describe('tron trace / replay', () => {
  it('records commands into a bundle between start and stop', async () => {
    const h = harness();
    expect(await run(['trace', 'start', bundle], h.deps)).toBe(EXIT.ok);
    await run(['click', '@e1'], h.deps);
    await run(['fill', '@e2', 'secret'], h.deps);
    expect(await run(['trace', 'stop'], h.deps)).toBe(EXIT.ok);

    const cmds = await readCommands(bundle);
    expect(cmds.map((c) => c.name)).toEqual(['click', 'fill']);
    expect(cmds[1].args.value).toBe('[redacted]'); // never persists the value
  });

  it('does not record when no trace is active', async () => {
    const h = harness();
    await run(['click', '@e1'], h.deps); // no trace started
    // starting now yields an empty bundle
    await run(['trace', 'start', bundle], h.deps);
    expect(await readCommands(bundle)).toHaveLength(0);
  });

  it('reports trace status', async () => {
    const h = harness();
    await run(['trace', 'status'], h.deps);
    await run(['trace', 'start', bundle], h.deps);
    await run(['trace', 'status'], h.deps);
    expect(h.out[0]).toBe('no active trace');
    expect(h.out[h.out.length - 1]).toContain(bundle);
  });

  it('replays clicks and skips redacted fills', async () => {
    // record a click + a fill
    const rec = harness();
    await run(['trace', 'start', bundle], rec.deps);
    await run(['click', '@e1'], rec.deps);
    await run(['fill', '@e2', 'secret'], rec.deps);
    await run(['trace', 'stop'], rec.deps);

    // replay against a fresh session, watching which expressions run
    const exprs: string[] = [];
    const play = harness((e) => exprs.push(e));
    const code = await run(['replay', bundle], play.deps);
    expect(code).toBe(EXIT.ok);
    expect(play.out.join('\n')).toContain('replayed click @e1');
    expect(play.out.join('\n')).toContain('skip fill @e2 (value redacted)');
    // the click expression ran; the redacted fill did not
    expect(exprs.some((e) => e.includes("data-tron-ref") && e.includes('click'))).toBe(true);
  });

  it('rejects an unknown trace subcommand', async () => {
    const h = harness();
    expect(await run(['trace', 'wat'], h.deps)).toBe(EXIT.usage);
  });
});
