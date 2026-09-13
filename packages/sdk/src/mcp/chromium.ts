/**
 * A Chromium the SDK spawns itself (PRD M3.8). The desktop path goes through
 * `tron-session` and the launcher shim; a server, a container, or a box with
 * only the engine installed has neither. This starts the binary headless with
 * a throwaway profile, finds the DevTools port it picked, and hands out
 * isolated page targets: one per call for a public relay, one kept open for a
 * local session. The browser shuts itself down after sitting idle.
 */
import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { CdpClient, type CdpConnection } from '@tronbrowser/browser-core';
import { Page } from '../page.js';
import { McpBrowserSession, type McpPage } from './session.js';

export interface ChromiumOptions {
  /** The binary. Default: resolveChromiumBin(); an explicit undefined means none. */
  bin?: string | undefined;
  headless?: boolean;
  /** Shut the browser down after this long with no page open. Default 5 min; 0 keeps it. */
  idleMs?: number;
  /** Refuse to resolve loopback, link-local and RFC1918 names (a public relay wants this). */
  blockPrivate?: boolean;
  /** Chromium refuses to run its sandbox as root; a container usually has to say so. */
  noSandbox?: boolean;
  extraArgs?: string[];
  log?: (line: string) => void;
  connect?: (wsUrl: string) => Promise<CdpConnection>;
}

export const DEFAULT_IDLE_MS = 5 * 60_000;
const LAUNCH_TIMEOUT_MS = 20_000;

const CANDIDATES = [
  'ungoogled-chromium',
  'ungoogled-chromium-stable',
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
];
const FIXED = ['/opt/ungoogled-chromium/chrome', '/opt/google/chrome/chrome', '/usr/lib/chromium/chromium'];

/** `TRON_CHROMIUM_BIN`, then PATH, then the usual fixed spots. Ungoogled builds first. */
export function resolveChromiumBin(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.TRON_CHROMIUM_BIN;
  if (explicit && existsSync(explicit)) return explicit;
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const name of CANDIDATES) {
    for (const dir of dirs) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return FIXED.find((p) => existsSync(p));
}

/** Names Chromium must not resolve when the caller is untrusted. */
export function privateHostRules(): string {
  const rules = ['MAP localhost ~NOTFOUND', 'MAP *.localhost ~NOTFOUND', 'MAP *.local ~NOTFOUND', 'MAP *.internal ~NOTFOUND', 'MAP 127.* ~NOTFOUND', 'MAP 0.* ~NOTFOUND', 'MAP 10.* ~NOTFOUND', 'MAP 169.254.* ~NOTFOUND', 'MAP 192.168.* ~NOTFOUND', 'MAP metadata.google.internal ~NOTFOUND'];
  for (let i = 16; i <= 31; i++) rules.push(`MAP 172.${i}.* ~NOTFOUND`);
  return rules.join(', ');
}

interface Running {
  proc: ReturnType<typeof spawn>;
  dataDir: string;
  port: number;
  browser: CdpConnection;
}

export class DirectChromium {
  readonly bin: string | undefined;
  readonly #opts: ChromiumOptions;
  #running: Running | undefined;
  #starting: Promise<Running> | undefined;
  #open = 0;
  #idle: NodeJS.Timeout | undefined;

  constructor(options: ChromiumOptions = {}) {
    this.#opts = options;
    this.bin = 'bin' in options ? options.bin : resolveChromiumBin();
  }

  available(): boolean {
    return this.bin !== undefined;
  }

  running(): boolean {
    return this.#running !== undefined;
  }

  /** Pages currently handed out. */
  openPages(): number {
    return this.#open;
  }

  version(): Promise<string | undefined> {
    const bin = this.bin;
    if (!bin) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      execFile(bin, ['--version'], { timeout: 10_000 }, (err, stdout) => resolve(err ? undefined : stdout.trim()));
    });
  }

  args(dataDir: string): string[] {
    const o = this.#opts;
    return [
      ...(o.headless === false ? [] : ['--headless=new']),
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-component-update',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--mute-audio',
      '--window-size=1280,900',
      '--remote-debugging-port=0',
      `--user-data-dir=${dataDir}`,
      ...(o.noSandbox ? ['--no-sandbox'] : []),
      ...(o.blockPrivate ? [`--host-resolver-rules=${privateHostRules()}`] : []),
      ...(o.extraArgs ?? []),
      'about:blank',
    ];
  }

  /** An isolated page target; `close` shuts the tab. */
  async page(): Promise<{ page: McpPage; close: () => Promise<void> }> {
    const run = await this.#ensure();
    const { targetId } = await run.browser.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const connect = this.#opts.connect ?? ((url: string) => CdpClient.connect(url));
    let conn: CdpConnection;
    try {
      conn = await connect(`ws://127.0.0.1:${run.port}/devtools/page/${targetId}`);
    } catch (err) {
      await run.browser.send('Target.closeTarget', { targetId }).catch(() => {});
      throw err;
    }
    const page = (await Page.attach(conn, targetId)) as unknown as McpPage;
    this.#open++;
    this.#armIdle();
    let closed = false;
    return {
      page,
      close: async () => {
        if (closed) return;
        closed = true;
        this.#open--;
        conn.close();
        if (this.#running === run) await run.browser.send('Target.closeTarget', { targetId }).catch(() => {});
        this.#armIdle();
      },
    };
  }

  /** A session over this engine: one page, opened on first use, closed with the session. */
  session(): McpBrowserSession {
    return new McpBrowserSession(() => this.page());
  }

  /** Stop the browser and delete its profile. Pages handed out become dead. */
  async close(): Promise<void> {
    if (this.#idle) clearTimeout(this.#idle);
    this.#idle = undefined;
    const run = this.#running ?? (await this.#starting?.catch(() => undefined));
    this.#running = undefined;
    this.#starting = undefined;
    this.#open = 0;
    if (!run) return;
    run.browser.close();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        run.proc.kill('SIGKILL');
        resolve();
      }, 3000);
      run.proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      run.proc.kill();
    });
    await rm(run.dataDir, { recursive: true, force: true }).catch(() => {});
  }

  #armIdle(): void {
    if (this.#idle) clearTimeout(this.#idle);
    this.#idle = undefined;
    const idleMs = this.#opts.idleMs ?? DEFAULT_IDLE_MS;
    if (!idleMs || this.#open > 0 || !this.#running) return;
    this.#idle = setTimeout(() => {
      if (this.#open === 0) void this.close();
    }, idleMs);
    this.#idle.unref?.();
  }

  #ensure(): Promise<Running> {
    if (this.#running) return Promise.resolve(this.#running);
    this.#starting ??= this.#launch().then(
      (run) => {
        this.#running = run;
        this.#starting = undefined;
        return run;
      },
      (err) => {
        this.#starting = undefined;
        throw err;
      },
    );
    return this.#starting;
  }

  async #launch(): Promise<Running> {
    const bin = this.bin;
    if (!bin) throw new Error('No Chromium found (set TRON_CHROMIUM_BIN or install ungoogled-chromium).');
    const dataDir = await mkdtemp(join(tmpdir(), 'tron-chromium-'));
    const proc = spawn(bin, this.args(dataDir), { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 8000) stderr += chunk.toString('utf8');
    });
    proc.once('exit', () => {
      if (this.#running?.proc === proc) {
        this.#running = undefined;
        this.#open = 0;
        this.#opts.log?.('chromium exited');
      }
    });
    try {
      const port = await this.#waitForPort(dataDir, proc);
      const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json() as Promise<{ webSocketDebuggerUrl: string }>);
      const connect = this.#opts.connect ?? ((url: string) => CdpClient.connect(url));
      const browser = await connect(version.webSocketDebuggerUrl);
      this.#opts.log?.(`chromium up: pid ${proc.pid} port ${port}`);
      return { proc, dataDir, port, browser };
    } catch (err) {
      proc.kill('SIGKILL');
      await rm(dataDir, { recursive: true, force: true }).catch(() => {});
      throw new Error(`${err instanceof Error ? err.message : String(err)}${stderr ? `\n${stderr.trim().split('\n').slice(-5).join('\n')}` : ''}`);
    }
  }

  /** Chromium writes `<profile>/DevToolsActivePort` once it listens: the port on line 1. */
  async #waitForPort(dataDir: string, proc: ReturnType<typeof spawn>): Promise<number> {
    const file = join(dataDir, 'DevToolsActivePort');
    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error(`chromium exited with ${proc.exitCode} before listening`);
      const text = await readFile(file, 'utf8').catch(() => '');
      const port = Number(text.split('\n')[0]);
      if (Number.isInteger(port) && port > 0) return port;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('chromium did not open its DevTools port in time');
  }
}
