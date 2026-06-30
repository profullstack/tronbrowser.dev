/**
 * Local Tor daemon lifecycle for TronBrowser's `--tor` mode.
 *
 * Two layers, mirroring `chromium-flags.ts` / `launcher.ts`:
 *  - Pure, unit-testable helpers (binary resolution, arg building, log parsing).
 *  - A thin `TorDaemon` process wrapper that starts `tor`, waits for the circuit
 *    to bootstrap, and tears it down.
 *
 * This routes traffic through Tor (hides IP, reaches `.onion`). It is NOT
 * Tor-Browser-grade anonymity — see `docs/tor-onion-mode.md`.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { DEFAULT_TOR_SOCKS_PORT } from './chromium-flags.js';
import type { DesktopPlatform } from './binary.js';

const TOR_BINARY_NAME: Record<DesktopPlatform, string> = {
  linux: 'tor',
  darwin: 'tor',
  win32: 'tor.exe',
};

export interface TorOptions {
  /** SOCKS5 port for Tor to listen on. Defaults to 9050. */
  socksPort?: number;
  /** Tor's working directory (cached descriptors, etc.). */
  dataDir?: string;
  /**
   * Directory holding a bundled `tor` binary shipped with the browser. When
   * unset, falls back to a `tor` found on PATH.
   */
  bundledDir?: string;
  /** Optional Tor control port (omitted when unset). */
  controlPort?: number;
  platform?: DesktopPlatform;
}

/**
 * Resolves the `tor` executable to run: a bundled binary next to the browser if
 * `bundledDir` is given, otherwise the bare command name resolved via PATH.
 */
export function resolveTorBinary(opts: TorOptions = {}): string {
  const platform = (opts.platform ?? process.platform) as DesktopPlatform;
  const name = TOR_BINARY_NAME[platform];
  if (!name) {
    throw new Error(`Unsupported platform for Tor: ${platform}`);
  }
  return opts.bundledDir ? join(opts.bundledDir, name) : name;
}

/**
 * Builds the `tor` command-line arguments. Pure data so it is auditable and
 * testable. `SocksPort` binds loopback only; we never expose Tor off-box.
 */
export function buildTorArgs(opts: TorOptions = {}): string[] {
  const socksPort = opts.socksPort ?? DEFAULT_TOR_SOCKS_PORT;
  const args = ['--SocksPort', `127.0.0.1:${socksPort}`];

  if (opts.dataDir) {
    args.push('--DataDirectory', opts.dataDir);
  }

  if (opts.controlPort !== undefined) {
    args.push('--ControlPort', `127.0.0.1:${opts.controlPort}`);
  }

  return args;
}

/**
 * Parses Tor's `Bootstrapped NN% (...)` progress lines into a 0..100 number.
 * Returns null for lines that don't report bootstrap progress.
 */
export function parseBootstrapProgress(line: string): number | null {
  const match = /Bootstrapped (\d{1,3})%/.exec(line);
  if (!match) {
    return null;
  }
  const pct = Number(match[1]);
  return pct >= 0 && pct <= 100 ? pct : null;
}

/** True once a log line indicates the Tor circuit is fully bootstrapped. */
export function isBootstrapComplete(line: string): boolean {
  return parseBootstrapProgress(line) === 100;
}

export interface StartTorOptions extends TorOptions {
  /** Max ms to wait for bootstrap before giving up. Defaults to 60s. */
  timeoutMs?: number;
  /** Called with 0..100 as Tor bootstraps, for progress UI. */
  onProgress?: (pct: number) => void;
}

const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 60_000;

/**
 * Thin wrapper around a `tor` child process. `start()` resolves once Tor reports
 * 100% bootstrapped, so the browser is never launched against a half-open
 * circuit. `stop()` terminates the daemon.
 */
export class TorDaemon {
  private child: ChildProcess | null = null;

  constructor(private readonly opts: StartTorOptions = {}) {}

  /** Whether the daemon process is currently running. */
  get running(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /** Spawns Tor and resolves when the circuit is bootstrapped. */
  start(): Promise<void> {
    if (this.running) {
      return Promise.resolve();
    }

    const binary = resolveTorBinary(this.opts);
    const args = buildTorArgs(this.opts);
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_BOOTSTRAP_TIMEOUT_MS;

    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const finish = (err?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          this.stop();
          reject(err);
        } else {
          resolve();
        }
      };

      const timer = setTimeout(() => {
        finish(new Error(`Tor failed to bootstrap within ${timeoutMs}ms`));
      }, timeoutMs);

      const onLine = (chunk: Buffer): void => {
        for (const line of chunk.toString('utf8').split('\n')) {
          const pct = parseBootstrapProgress(line);
          if (pct !== null) {
            this.opts.onProgress?.(pct);
            if (pct === 100) {
              finish();
            }
          }
        }
      };

      child.stdout?.on('data', onLine);
      child.stderr?.on('data', onLine);

      child.once('error', (err) => {
        finish(
          new Error(
            `Could not start Tor ("${binary}"). Install Tor or bundle it. Cause: ${err.message}`,
          ),
        );
      });

      child.once('exit', (code) => {
        finish(new Error(`Tor exited before bootstrapping (code ${code ?? 'null'})`));
      });
    });
  }

  /** Terminates the Tor daemon if running. */
  stop(): void {
    if (this.child && this.child.exitCode === null) {
      this.child.kill();
    }
    this.child = null;
  }
}
