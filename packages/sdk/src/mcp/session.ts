/**
 * The browser session an MCP server drives (PRD M3.6). Lazily launches a managed
 * session on first tool use and hands out a page. Structural `McpPage` keeps it
 * testable — the concrete SDK Page satisfies it, and fakes can too.
 */
import type { AgentSnapshot } from '@tronbrowser/browser-core';
import type { AnalyzeOptions, AnalyzeResult } from '@tronbrowser/agent-runtime';
import { Browser, type LaunchOptions } from '../browser.js';

export interface McpPage {
  id: string;
  goto(url: string): Promise<void>;
  snapshot(): Promise<AgentSnapshot>;
  click(ref: string): Promise<void>;
  fill(ref: string, value: string): Promise<void>;
  extract(target: string): Promise<unknown>;
  screenshot(): Promise<Uint8Array>;
  eval<T = unknown>(code: string): Promise<T>;
  url(): Promise<string>;
  title(): Promise<string>;
  analyze(goal?: string, options?: AnalyzeOptions): Promise<AnalyzeResult>;
  step(goal: string, options?: AnalyzeOptions): Promise<AnalyzeResult>;
  runTask(goal: string, options?: AnalyzeOptions): Promise<AnalyzeResult>;
}

export interface Tab {
  id: string;
  url: string;
  title: string;
}

export type SessionLauncher = () => Promise<{ page: McpPage; close: () => Promise<void> }>;

export class McpBrowserSession {
  readonly #launch: SessionLauncher;
  #current: { page: McpPage; close: () => Promise<void> } | undefined;

  constructor(launch: SessionLauncher) {
    this.#launch = launch;
  }

  /** Default launcher: a managed SDK Browser + one page. */
  static fromSdk(options: LaunchOptions = {}): McpBrowserSession {
    return new McpBrowserSession(async () => {
      const browser = await Browser.launch(options);
      const page = (await browser.newPage()) as unknown as McpPage;
      return { page, close: () => browser.close() };
    });
  }

  async getPage(): Promise<McpPage> {
    this.#current ??= await this.#launch();
    return this.#current.page;
  }

  async tabs(): Promise<Tab[]> {
    const page = await this.getPage();
    return [{ id: page.id, url: await page.url(), title: await page.title() }];
  }

  async close(): Promise<void> {
    const current = this.#current;
    this.#current = undefined;
    await current?.close();
  }
}
