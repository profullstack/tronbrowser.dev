import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readActiveTrace,
  readCommands,
  recordCommand,
  redactArgs,
  startTrace,
  stopTrace,
  tracePointerPath,
} from './trace.js';
import type { AgentSnapshot } from './snapshot-script.js';

let dataDir: string;
let bundle: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'trace-data-'));
  bundle = join(dataDir, 'run.trontrace');
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

const snap: AgentSnapshot = { url: 'https://x/', title: 'X', timestamp: 't', elements: [] };

describe('redactArgs', () => {
  it('redacts fill/type values but keeps the ref', () => {
    expect(redactArgs('fill', { ref: '@e2', value: 'secret' })).toEqual({
      ref: '@e2', value: '[redacted]', valueRedacted: true,
    });
    expect(redactArgs('click', { ref: '@e1' })).toEqual({ ref: '@e1' });
  });
});

describe('trace lifecycle', () => {
  it('starts, records, and stops a bundle', async () => {
    await startTrace(dataDir, bundle);
    const active = await readActiveTrace(dataDir);
    expect(active?.dir).toBe(bundle);

    await recordCommand(bundle, 'click', { ref: '@e1' }, { snapshot: snap });
    await recordCommand(bundle, 'fill', { ref: '@e2', value: 'secret' });

    const cmds = await readCommands(bundle);
    expect(cmds.map((c) => c.name)).toEqual(['click', 'fill']);
    expect(cmds[0].seq).toBe(1);
    expect(cmds[0].snapshot).toBe('snapshots/0001.json');
    // value redacted on write
    expect(cmds[1].args.value).toBe('[redacted]');
    expect(cmds[1].args.valueRedacted).toBe(true);
    // snapshot persisted
    expect(JSON.parse(readFileSync(join(bundle, 'snapshots/0001.json'), 'utf8')).title).toBe('X');

    const stopped = await stopTrace(dataDir);
    expect(stopped).toEqual({ dir: bundle, commands: 2 });
    const meta = JSON.parse(readFileSync(join(bundle, 'metadata.json'), 'utf8'));
    expect(meta.commands).toBe(2);
    expect(meta.stoppedAt).toBeDefined();
    // pointer cleared
    expect(await readActiveTrace(dataDir)).toBeUndefined();
  });

  it('records an error alongside the command', async () => {
    await startTrace(dataDir, bundle);
    await recordCommand(bundle, 'click', { ref: '@e9' }, { error: 'STALE_REF' });
    const errors = readFileSync(join(bundle, 'errors.jsonl'), 'utf8').trim();
    expect(JSON.parse(errors).error).toBe('STALE_REF');
  });

  it('stop returns undefined when nothing is active', async () => {
    expect(await stopTrace(dataDir)).toBeUndefined();
  });

  it('exposes the pointer path under the data dir', () => {
    expect(tracePointerPath('/d')).toBe('/d/automation/trace.json');
  });
});
