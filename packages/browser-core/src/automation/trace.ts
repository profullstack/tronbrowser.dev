/**
 * Trace bundle format for `tron trace` / `tron replay` (PRD M3.7 / §19).
 *
 * A `.trontrace` bundle is a directory of JSONL + JSON:
 *   metadata.json         run info (version, started/stopped, command count)
 *   commands.jsonl        one record per recorded command (values redacted)
 *   snapshots/NNNN.json   page snapshot captured after a command
 *   errors.jsonl          errors, keyed by command seq
 *
 * Recording is cross-process (each `tron` command is its own process), so an
 * "active trace" pointer under the data dir tells commands where to append.
 * Form values are redacted by default (PRD §20).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { AgentSnapshot } from './snapshot-script.js';

export const TRACE_VERSION = 1 as const;

export interface TraceMetadata {
  version: 1;
  startedAt: string;
  stoppedAt?: string;
  commands: number;
}

export interface TraceCommandRecord {
  seq: number;
  t: string;
  name: string;
  args: Record<string, unknown>;
  error?: string;
  snapshot?: string; // relative path, e.g. "snapshots/0001.json"
}

export interface ActiveTracePointer {
  dir: string;
  startedAt: string;
}

/** Path of the active-trace pointer within a data dir. */
export function tracePointerPath(dataDir: string): string {
  return `${dataDir}/automation/trace.json`;
}

/** Redact sensitive command args (form values) before persisting. */
export function redactArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if ((name === 'fill' || name === 'type') && 'value' in args) {
    return { ...args, value: '[redacted]', valueRedacted: true };
  }
  return { ...args };
}

async function readJsonl(path: string): Promise<string[]> {
  try {
    const raw = await readFile(path, 'utf8');
    return raw.split('\n').filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}

/** The active trace pointer, if recording is on. */
export async function readActiveTrace(dataDir: string): Promise<ActiveTracePointer | undefined> {
  try {
    return JSON.parse(await readFile(tracePointerPath(dataDir), 'utf8')) as ActiveTracePointer;
  } catch {
    return undefined;
  }
}

/** Begin recording into `dir`, writing the pointer under `dataDir`. */
export async function startTrace(dataDir: string, dir: string): Promise<void> {
  await mkdir(`${dir}/snapshots`, { recursive: true });
  const meta: TraceMetadata = { version: TRACE_VERSION, startedAt: new Date().toISOString(), commands: 0 };
  await writeFile(`${dir}/metadata.json`, JSON.stringify(meta, null, 2) + '\n');
  await writeFile(`${dir}/commands.jsonl`, '');
  await mkdir(`${dataDir}/automation`, { recursive: true });
  await writeFile(tracePointerPath(dataDir), JSON.stringify({ dir, startedAt: meta.startedAt }) + '\n');
}

/** Finalize the active trace and clear the pointer. */
export async function stopTrace(dataDir: string): Promise<{ dir: string; commands: number } | undefined> {
  const active = await readActiveTrace(dataDir);
  if (!active) return undefined;
  const commands = (await readJsonl(`${active.dir}/commands.jsonl`)).length;
  let meta: TraceMetadata;
  try {
    meta = JSON.parse(await readFile(`${active.dir}/metadata.json`, 'utf8')) as TraceMetadata;
  } catch {
    meta = { version: TRACE_VERSION, startedAt: active.startedAt, commands };
  }
  meta.stoppedAt = new Date().toISOString();
  meta.commands = commands;
  await writeFile(`${active.dir}/metadata.json`, JSON.stringify(meta, null, 2) + '\n');
  await writeFile(tracePointerPath(dataDir), ''); // clear pointer (empty = inactive)
  return { dir: active.dir, commands };
}

/** Append a command to the bundle, optionally with its resulting snapshot. */
export async function recordCommand(
  dir: string,
  name: string,
  args: Record<string, unknown>,
  extra: { snapshot?: AgentSnapshot; error?: string } = {},
): Promise<number> {
  const seq = (await readJsonl(`${dir}/commands.jsonl`)).length + 1;
  const record: TraceCommandRecord = { seq, t: new Date().toISOString(), name, args: redactArgs(name, args) };
  if (extra.error) record.error = extra.error;
  if (extra.snapshot) {
    const rel = `snapshots/${String(seq).padStart(4, '0')}.json`;
    await mkdir(`${dir}/snapshots`, { recursive: true });
    await writeFile(`${dir}/${rel}`, JSON.stringify(extra.snapshot, null, 2) + '\n');
    record.snapshot = rel;
  }
  await appendLine(`${dir}/commands.jsonl`, JSON.stringify(record));
  if (extra.error) await appendLine(`${dir}/errors.jsonl`, JSON.stringify({ seq, error: extra.error }));
  return seq;
}

async function appendLine(path: string, line: string): Promise<void> {
  const existing = await readFile(path, 'utf8').catch(() => '');
  await writeFile(path, existing + line + '\n');
}

/** Read the recorded commands from a bundle (for replay/inspection). */
export async function readCommands(dir: string): Promise<TraceCommandRecord[]> {
  return (await readJsonl(`${dir}/commands.jsonl`)).map((l) => JSON.parse(l) as TraceCommandRecord);
}
