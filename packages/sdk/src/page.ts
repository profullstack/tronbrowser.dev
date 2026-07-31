/**
 * A page in a managed session (PRD M3.4 / §15.2). Wraps a persistent CDP
 * connection to one page target and exposes the automation primitives from
 * @tronbrowser/browser-core with a clean, CDP-free API.
 */
import {
  captureSnapshot,
  clickRef,
  enableRuntime,
  extract as evalExpression,
  extractExpression,
  fillRef,
  formatSnapshotText,
  goto,
  printPdf,
  screenshotPng,
  type AgentSnapshot,
  type CdpConnection,
  type FieldSpec,
  type ScreenshotOptions,
  type SnapshotOptions,
} from '@tronbrowser/browser-core';
import {
  analyze,
  analyzeFormsExpression,
  type AnalyzeBrowser,
  type AnalyzeOptions,
  type AnalyzeResult,
  type RawFormsResult,
} from '@tronbrowser/agent-runtime';
import type { Tracer } from './trace.js';

export class Page {
  readonly #conn: CdpConnection;
  readonly #tracer: Tracer | undefined;
  readonly id: string;
  #closed = false;

  /** @internal — use Browser.newPage(). */
  constructor(conn: CdpConnection, targetId: string, tracer?: Tracer) {
    this.#conn = conn;
    this.id = targetId;
    this.#tracer = tracer;
  }

  /** @internal */
  static async attach(conn: CdpConnection, targetId: string, tracer?: Tracer): Promise<Page> {
    await enableRuntime(conn);
    await conn.send('Page.enable');
    return new Page(conn, targetId, tracer);
  }

  async goto(url: string, options: { timeoutMs?: number } = {}): Promise<void> {
    this.#tracer?.record('goto', url);
    await goto(this.#conn, url, options);
  }

  reload(): Promise<void> {
    this.#tracer?.record('reload');
    return this.#conn.send('Page.reload').then(() => undefined);
  }

  back(): Promise<void> {
    this.#tracer?.record('back');
    return this.eval('history.back()').then(() => undefined);
  }

  forward(): Promise<void> {
    this.#tracer?.record('forward');
    return this.eval('history.forward()').then(() => undefined);
  }

  snapshot(options: SnapshotOptions = {}): Promise<AgentSnapshot> {
    this.#tracer?.record('snapshot');
    return captureSnapshot(this.#conn, options);
  }

  async snapshotText(options: SnapshotOptions = {}): Promise<string> {
    return formatSnapshotText(await this.snapshot(options));
  }

  async click(ref: string): Promise<void> {
    this.#tracer?.record('click', ref);
    await clickRef(this.#conn, ref);
  }

  async fill(ref: string, value: string): Promise<void> {
    this.#tracer?.record('fill', ref); // value redacted from the trace
    await fillRef(this.#conn, ref, value);
  }

  /** Alias of fill for MVP (character-level typing lands with richer input in M3.5+). */
  type(ref: string, value: string): Promise<void> {
    return this.fill(ref, value);
  }

  extract<T = unknown>(target: string, fields: FieldSpec[] = []): Promise<T> {
    this.#tracer?.record('extract', target);
    return evalExpression<T>(this.#conn, extractExpression(target, fields));
  }

  eval<T = unknown>(code: string): Promise<T> {
    return evalExpression<T>(this.#conn, code);
  }

  screenshot(options: ScreenshotOptions = {}): Promise<Uint8Array> {
    this.#tracer?.record('screenshot');
    return screenshotPng(this.#conn, options);
  }

  pdf(): Promise<Uint8Array> {
    this.#tracer?.record('pdf');
    return printPdf(this.#conn);
  }

  url(): Promise<string> {
    return this.eval<string>('location.href');
  }

  title(): Promise<string> {
    return this.eval<string>('document.title');
  }

  /** Adapter exposing this page to the analyze runtime. */
  #analyzeBrowser(): AnalyzeBrowser {
    return {
      snapshot: () => this.snapshot(),
      readForms: () => this.eval<RawFormsResult>(analyzeFormsExpression()),
      fill: (ref, value) => this.fill(ref, value),
      click: (ref) => this.click(ref),
    };
  }

  /** Analyze the page / map a form to data (dry-run unless `execute`). */
  analyze(goal?: string, options: AnalyzeOptions = {}): Promise<AnalyzeResult> {
    this.#tracer?.record('analyze', goal);
    return analyze(this.#analyzeBrowser(), { ...options, ...(goal ? { goal } : {}) });
  }

  /** One bounded step toward a goal (execute, capped). */
  step(goal: string, options: AnalyzeOptions = {}): Promise<AnalyzeResult> {
    this.#tracer?.record('step', goal);
    return analyze(this.#analyzeBrowser(), { ...options, goal, execute: true, maxSteps: 1 });
  }

  /** Run the bounded analyze loop to completion for a goal. */
  runTask(goal: string, options: AnalyzeOptions = {}): Promise<AnalyzeResult> {
    this.#tracer?.record('runTask', goal);
    return analyze(this.#analyzeBrowser(), { ...options, goal, execute: true });
  }

  /** @internal */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#conn.close();
  }
}
