/**
 * Obscura as an engine (PRD M3.8). Obscura is a headless browser with its own
 * rendering engine and a real V8: it starts in milliseconds, renders a light
 * page in tens of milliseconds and holds ~30 MB doing it, which is the scraping
 * profile Chromium cannot match. It ships an MCP server, so the SDK drives it
 * as an MCP client over stdio (newline-delimited JSON-RPC on a child process).
 *
 * Stdio on purpose: Obscura's HTTP transport answers the first request on a
 * connection fast and then stalls every later request on that connection by
 * ~4 s, and a child process needs no port anyway.
 */
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { JsonRpcMessage, McpContent } from './protocol.js';

export interface ObscuraToolResult {
  content: McpContent[];
  isError?: boolean;
}

/** The bits of a child process the client needs; fakes stand in for tests. */
export interface ObscuraProcess {
  stdin: { write(chunk: string): unknown };
  stdout: AsyncIterable<string | Uint8Array>;
  kill(): void;
  onExit(cb: () => void): void;
}

export type ObscuraSpawner = (bin: string, args: string[]) => ObscuraProcess;

export interface ObscuraOptions {
  /** Path to the obscura binary. Default: resolveObscuraBin(); an explicit undefined means none. */
  bin?: string | undefined;
  /** Run Obscura with --stealth (Chrome TLS fingerprint + tracker blocklist). */
  stealth?: boolean;
  /** Per-call timeout; a call past it rejects and the engine is restarted. */
  timeoutMs?: number;
  spawn?: ObscuraSpawner;
}

export const DEFAULT_OBSCURA_TIMEOUT_MS = 30_000;

/**
 * Where the obscura binary is. `TRON_OBSCURA_BIN` is what the `tron` CLI sets
 * (the installer puts Obscura next to the launcher), `OBSCURA_BIN` is the
 * convention the rest of the fleet uses, then PATH.
 */
export function resolveObscuraBin(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of ['TRON_OBSCURA_BIN', 'OBSCURA_BIN']) {
    const value = env[key];
    if (value && existsSync(value)) return value;
  }
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'obscura');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const defaultSpawn: ObscuraSpawner = (bin, args) => {
  const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'] });
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    kill: () => {
      child.kill();
    },
    onExit: (cb) => {
      child.once('exit', cb);
      child.once('error', cb);
    },
  };
};

interface Pending {
  resolve: (msg: JsonRpcMessage) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class ObscuraClient {
  readonly bin: string | undefined;
  readonly #stealth: boolean;
  readonly #timeoutMs: number;
  readonly #spawn: ObscuraSpawner;
  #proc: ObscuraProcess | undefined;
  #ready: Promise<void> | undefined;
  #nextId = 1;
  readonly #pending = new Map<number, Pending>();

  constructor(options: ObscuraOptions = {}) {
    // An explicit `bin: undefined` means "none"; only an absent key resolves.
    this.bin = 'bin' in options ? options.bin : resolveObscuraBin();
    this.#stealth = options.stealth ?? false;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_OBSCURA_TIMEOUT_MS;
    this.#spawn = options.spawn ?? defaultSpawn;
  }

  /** True when there is a binary to run. Nothing is spawned until the first call. */
  available(): boolean {
    return this.bin !== undefined;
  }

  running(): boolean {
    return this.#proc !== undefined;
  }

  /** `obscura --version`, or undefined when the binary is missing or broken. */
  version(): Promise<string | undefined> {
    const bin = this.bin;
    if (!bin) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      execFile(bin, ['--version'], { timeout: 5000 }, (err, stdout) => {
        resolve(err ? undefined : stdout.trim().replace(/^obscura\s+/, ''));
      });
    });
  }

  /** Call one Obscura MCP tool; rejects on transport failure or timeout. */
  async call(name: string, args: Record<string, unknown> = {}, timeoutMs = this.#timeoutMs): Promise<ObscuraToolResult> {
    await this.#ensure();
    const msg = await this.#request('tools/call', { name, arguments: args }, timeoutMs);
    if (msg.error) throw new Error(msg.error.message);
    const result = (msg.result ?? {}) as Partial<ObscuraToolResult>;
    return { content: result.content ?? [], ...(result.isError ? { isError: true } : {}) };
  }

  /** Stop the engine. The next call starts a fresh one. */
  async close(): Promise<void> {
    const proc = this.#proc;
    this.#proc = undefined;
    this.#ready = undefined;
    this.#failAll(new Error('Obscura closed'));
    proc?.kill();
  }

  #ensure(): Promise<void> {
    if (!this.bin) return Promise.reject(new Error('Obscura is not installed (set TRON_OBSCURA_BIN or put obscura on PATH).'));
    if (this.#ready) return this.#ready;
    const proc = this.#spawn(this.bin, ['mcp', ...(this.#stealth ? ['--stealth'] : [])]);
    this.#proc = proc;
    proc.onExit(() => {
      if (this.#proc === proc) {
        this.#proc = undefined;
        this.#ready = undefined;
      }
      this.#failAll(new Error('Obscura exited'));
    });
    void this.#read(proc);
    this.#ready = this.#request(
      'initialize',
      { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'tronbrowser', version: '3.9' } },
      this.#timeoutMs,
    ).then((msg) => {
      if (msg.error) throw new Error(msg.error.message);
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    });
    this.#ready.catch(() => this.close());
    return this.#ready;
  }

  async #read(proc: ObscuraProcess): Promise<void> {
    let buffer = '';
    try {
      for await (const chunk of proc.stdout) {
        buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let msg: JsonRpcMessage;
          try {
            msg = JSON.parse(line) as JsonRpcMessage;
          } catch {
            continue;
          }
          if (typeof msg.id !== 'number') continue;
          const pending = this.#pending.get(msg.id);
          if (!pending) continue;
          this.#pending.delete(msg.id);
          clearTimeout(pending.timer);
          pending.resolve(msg);
        }
      }
    } catch {
      // stream closed; onExit handles the rest
    }
  }

  #request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<JsonRpcMessage> {
    const proc = this.#proc;
    if (!proc) return Promise.reject(new Error('Obscura is not running'));
    const id = this.#nextId++;
    return new Promise<JsonRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Obscura timed out after ${timeoutMs}ms on ${method}`));
        // A stuck engine stays stuck; start over next time.
        void this.close();
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      } catch (err) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  #failAll(err: Error): void {
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(err);
    }
  }
}

/** The text of a tool result, blocks joined. */
export function resultText(result: ObscuraToolResult): string {
  return result.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n');
}
