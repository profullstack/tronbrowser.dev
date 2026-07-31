/**
 * A managed browser session (PRD M3.4 / §15.1). `tron.launch()` starts a
 * `tron-session`, and each Browser owns that session's lifecycle: it hands out
 * Page objects (one CDP connection per tab) and tears the session down on close.
 */
import type { CdpConnection, CdpTarget, SessionDescriptor } from '@tronbrowser/browser-core';
import { defaultDeps, type SdkDeps } from './deps.js';
import { Page } from './page.js';
import { Tracer, tracerFromEnv } from './trace.js';

export interface LaunchOptions {
  headless?: boolean;
  profile?: string;
}

export class Browser {
  readonly #deps: SdkDeps;
  readonly #dataDir: string;
  readonly #descriptor: SessionDescriptor;
  readonly #pages: Page[] = [];
  readonly #usedTargets = new Set<string>();
  readonly #tracer: Tracer | undefined;
  readonly #traceDir: string | undefined;
  #browserConn: CdpConnection | undefined;
  #closed = false;

  private constructor(
    deps: SdkDeps,
    dataDir: string,
    descriptor: SessionDescriptor,
    trace?: { tracer: Tracer; dir: string },
  ) {
    this.#deps = deps;
    this.#dataDir = dataDir;
    this.#descriptor = descriptor;
    this.#tracer = trace?.tracer;
    this.#traceDir = trace?.dir;
  }

  /** Launch a managed session and return a Browser. */
  static async launch(options: LaunchOptions = {}, deps: SdkDeps = defaultDeps): Promise<Browser> {
    // CLI flags from `tron run` arrive via env and win when the script is neutral.
    const headless = options.headless ?? process.env.TRON_RUN_HEADLESS === '1';
    const profile = options.profile ?? process.env.TRON_RUN_PROFILE;
    const dataDir = await deps.makeDataDir();
    try {
      await deps.launchSession(dataDir, {
        headless,
        ...(profile !== undefined ? { profile } : {}),
      });
      const descriptor = await deps.loadDescriptor(dataDir);
      return new Browser(deps, dataDir, descriptor, tracerFromEnv(process.env));
    } catch (err) {
      await deps.closeSession(dataDir).catch(() => {});
      await deps.removeDataDir(dataDir).catch(() => {});
      throw err;
    }
  }

  #targets(): Promise<CdpTarget[]> {
    return this.#deps.fetchTargets(this.#descriptor.host, this.#descriptor.port);
  }

  /** Open (or adopt the first free) page target and return a Page for it. */
  async newPage(): Promise<Page> {
    if (this.#closed) throw new Error('Browser is closed');

    let target = (await this.#targets()).find(
      (t) => t.type === 'page' && !this.#usedTargets.has(t.id),
    );
    if (!target) target = await this.#createTarget();
    if (!target.webSocketDebuggerUrl) {
      throw new Error(`Page target ${target.id} has no webSocketDebuggerUrl`);
    }

    const conn = await this.#deps.connect(target.webSocketDebuggerUrl);
    const page = await Page.attach(conn, target.id, this.#tracer);
    this.#usedTargets.add(target.id);
    this.#pages.push(page);
    return page;
  }

  async #createTarget(): Promise<CdpTarget> {
    if (!this.#descriptor.webSocketDebuggerUrl) {
      throw new Error('Cannot open another page: session has no browser WebSocket endpoint');
    }
    this.#browserConn ??= await this.#deps.connect(this.#descriptor.webSocketDebuggerUrl);
    const { targetId } = await this.#browserConn.send<{ targetId: string }>('Target.createTarget', {
      url: 'about:blank',
    });
    const created = (await this.#targets()).find((t) => t.id === targetId);
    if (!created) throw new Error('Newly created page target did not appear');
    return created;
  }

  /** Pages opened so far. */
  pages(): Page[] {
    return [...this.#pages];
  }

  /** Close every page, stop the managed session, and remove its temp profile. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const page of this.#pages) page.close();
    this.#browserConn?.close();
    if (this.#tracer && this.#traceDir) {
      await this.#tracer
        .flush(this.#traceDir, { headless: this.#descriptor.headless, profile: this.#descriptor.profileName })
        .catch(() => {});
    }
    await this.#deps.closeSession(this.#dataDir).catch(() => {});
    await this.#deps.removeDataDir(this.#dataDir).catch(() => {});
  }
}
