import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ObscuraClient, resolveObscuraBin, resultText, type ObscuraProcess } from './obscura.js';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'tron-obscura-'));
  dirs.push(d);
  return d;
}

describe('resolveObscuraBin', () => {
  it('prefers TRON_OBSCURA_BIN, then OBSCURA_BIN, then PATH, and only existing files', () => {
    const d = tmp();
    const a = join(d, 'a');
    const b = join(d, 'b');
    writeFileSync(a, '');
    writeFileSync(b, '');
    expect(resolveObscuraBin({ TRON_OBSCURA_BIN: a, OBSCURA_BIN: b, PATH: '' })).toBe(a);
    expect(resolveObscuraBin({ TRON_OBSCURA_BIN: join(d, 'missing'), OBSCURA_BIN: b, PATH: '' })).toBe(b);
    const onPath = join(d, 'obscura');
    writeFileSync(onPath, '');
    expect(resolveObscuraBin({ PATH: `${join(d, 'nope')}:${d}` })).toBe(onPath);
    expect(resolveObscuraBin({ PATH: join(d, 'nope') })).toBeUndefined();
  });
});

describe('ObscuraClient', () => {
  it('reports unavailable and refuses to call without a binary', async () => {
    const c = new ObscuraClient({ bin: undefined });
    expect(c.available()).toBe(false);
    expect(await c.version()).toBeUndefined();
    await expect(c.call('browser_navigate', { url: 'https://x/' })).rejects.toThrow(/not installed/);
  });

  it('reads the version from the binary', async () => {
    const d = tmp();
    const bin = join(d, 'obscura');
    writeFileSync(bin, '#!/bin/sh\necho "obscura 0.2.2"\n');
    chmodSync(bin, 0o755);
    const c = new ObscuraClient({ bin });
    expect(c.available()).toBe(true);
    expect(await c.version()).toBe('0.2.2');
  });

  it('initializes once, passes tool errors through, and fails pending calls when the engine exits', async () => {
    const written: string[] = [];
    let exitCb: (() => void) | undefined;
    const spawn = (bin: string, args: string[]): ObscuraProcess => {
      expect(bin).toBe('/x/obscura');
      expect(args).toEqual(['mcp', '--stealth']);
      const queue: string[] = [];
      let wake: (() => void) | undefined;
      let closed = false;
      return {
        stdin: {
          write(chunk: string) {
            written.push(chunk);
            const msg = JSON.parse(chunk) as { id?: number; method: string; params?: { name?: string } };
            if (msg.id === undefined) return;
            if (msg.method === 'initialize') queue.push(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
            else if (msg.params?.name === 'bad') queue.push(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'nope' }], isError: true } }) + '\n');
            else if (msg.params?.name === 'hang') return;
            else queue.push('garbage line\n' + JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }) + '\n');
            wake?.();
          },
        },
        stdout: (async function* () {
          while (!closed) {
            if (queue.length) { yield Buffer.from(queue.shift() as string); continue; }
            await new Promise<void>((r) => { wake = r; });
            wake = undefined;
          }
        })(),
        kill: () => { closed = true; wake?.(); },
        onExit: (cb) => { exitCb = cb; },
      };
    };
    const c = new ObscuraClient({ bin: '/x/obscura', stealth: true, spawn, timeoutMs: 500 });
    const ok = await c.call('good');
    expect(resultText(ok)).toBe('a\nb');
    expect(ok.isError).toBeUndefined();
    const bad = await c.call('bad');
    expect(bad.isError).toBe(true);
    expect(resultText(bad)).toBe('nope');
    // One initialize + one initialized notification for the whole life of the process.
    expect(written.filter((w) => w.includes('"initialize"'))).toHaveLength(1);
    expect(written.filter((w) => w.includes('notifications/initialized'))).toHaveLength(1);
    expect(c.running()).toBe(true);

    const pending = c.call('hang');
    await new Promise((r) => setImmediate(r)); // let the request register before the engine dies
    exitCb?.();
    await expect(pending).rejects.toThrow(/exited/);
    expect(c.running()).toBe(false);
  });
});
