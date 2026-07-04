/**
 * Minimal action trace for `tron run --trace <dir>` (PRD M3.4; full trace/replay
 * is M3.7). Records the sequence of page actions — never their values (form
 * input, secrets are redacted by default) — and flushes a small bundle on close.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface TraceEntry {
  t: string;
  action: string;
  detail?: string;
}

export class Tracer {
  readonly #entries: TraceEntry[] = [];

  /** Record an action. `detail` should be a ref/url/mode — never a value. */
  record(action: string, detail?: string): void {
    this.#entries.push({
      t: new Date().toISOString(),
      action,
      ...(detail !== undefined ? { detail } : {}),
    });
  }

  get entries(): readonly TraceEntry[] {
    return this.#entries;
  }

  /** Write metadata.json + actions.jsonl to the trace directory. */
  async flush(dir: string, meta: Record<string, unknown>): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'metadata.json'),
      JSON.stringify({ ...meta, actions: this.#entries.length, finishedAt: new Date().toISOString() }, null, 2) + '\n',
    );
    await writeFile(dir + '/actions.jsonl', this.#entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
}

/** A Tracer when `TRON_RUN_TRACE` names a directory, else undefined. */
export function tracerFromEnv(env: NodeJS.ProcessEnv): { tracer: Tracer; dir: string } | undefined {
  const dir = env.TRON_RUN_TRACE;
  if (!dir) return undefined;
  return { tracer: new Tracer(), dir };
}
