/**
 * Browser workflow nodes (PRD M3.8 / §21.1). A single BrowserNode handler
 * dispatches its `action` to the same SDK Page primitives used by the CLI and
 * MCP — so open/snapshot/click/fill/extract/screenshot/analyze/runTask all share
 * one implementation. A failed node surfaces recovery details.
 */
import type { AgentSnapshot, AnalyzeOptions, AnalyzeResult, LaunchOptions } from '@tronbrowser/sdk';
import { tron } from '@tronbrowser/sdk';
import { writeFile } from 'node:fs/promises';
import type { BrowserNode, ExecutionContext, NodeHandler, NodeResult } from '../index.js';

/** The subset of the SDK Page a browser node uses (fakeable in tests). */
export interface WorkflowPage {
  goto(url: string): Promise<void>;
  snapshot(): Promise<AgentSnapshot>;
  click(ref: string): Promise<void>;
  fill(ref: string, value: string): Promise<void>;
  extract(target: string): Promise<unknown>;
  screenshot(): Promise<Uint8Array>;
  analyze(goal?: string, options?: AnalyzeOptions): Promise<AnalyzeResult>;
  runTask(goal: string, options?: AnalyzeOptions): Promise<AnalyzeResult>;
}

/** A browser the workflow shares across its browser nodes. */
export interface WorkflowBrowser {
  page(): Promise<WorkflowPage>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface Recovery {
  recoverable: boolean;
  suggestion: string;
}

/** Error from a browser node, carrying recovery guidance for the runner. */
export class BrowserNodeError extends Error {
  readonly recovery: Recovery;
  constructor(message: string, recovery: Recovery) {
    super(message);
    this.name = 'BrowserNodeError';
    this.recovery = recovery;
  }
}

function require(value: string | undefined, field: string, action: string): string {
  if (value === undefined || value === '') {
    throw new BrowserNodeError(`browser.${action} requires "${field}"`, {
      recoverable: false,
      suggestion: `Set config.${field} on the browser node.`,
    });
  }
  return value;
}

/** Default WorkflowBrowser backed by a managed SDK session (lazy). */
export function sdkBrowser(options: LaunchOptions = {}): WorkflowBrowser {
  let launched: { page: WorkflowPage; close: () => Promise<void> } | undefined;
  return {
    async page() {
      if (!launched) {
        const browser = await tron.launch(options);
        const page = (await browser.newPage()) as unknown as WorkflowPage;
        launched = { page, close: () => browser.close() };
      }
      return launched.page;
    },
    writeBytes: (path, bytes) => writeFile(path, bytes),
    async close() {
      await launched?.close();
      launched = undefined;
    },
  };
}

/** Create the browser node handler bound to a shared browser. */
export function createBrowserNodeHandler(browser: WorkflowBrowser): NodeHandler<BrowserNode> {
  return {
    type: 'browser',
    async run(node: BrowserNode, _ctx: ExecutionContext): Promise<NodeResult> {
      const c = node.config;
      const page = await browser.page();
      let output: unknown;
      switch (c.action) {
        case 'open':
          await page.goto(require(c.url, 'url', 'open'));
          output = await page.snapshot();
          break;
        case 'snapshot':
          output = await page.snapshot();
          break;
        case 'click':
          await page.click(require(c.ref, 'ref', 'click'));
          output = await page.snapshot();
          break;
        case 'fill':
        case 'type':
          await page.fill(require(c.ref, 'ref', c.action), c.value ?? '');
          output = await page.snapshot();
          break;
        case 'extract':
          output = await page.extract(c.mode ?? 'text');
          break;
        case 'screenshot': {
          const path = require(c.path, 'path', 'screenshot');
          await browser.writeBytes(path, await page.screenshot());
          output = { screenshot: path };
          break;
        }
        case 'analyze':
          output = await page.analyze(c.goal, {
            ...(c.data ? { data: c.data } : {}),
            ...(c.execute ? { execute: true } : {}),
          });
          break;
        case 'runTask':
          output = await page.runTask(require(c.goal, 'goal', 'runTask'), c.data ? { data: c.data } : {});
          break;
        default:
          throw new BrowserNodeError(`unknown browser action: ${String((c as { action: string }).action)}`, {
            recoverable: false,
            suggestion: 'Use one of: open, snapshot, click, fill, extract, screenshot, analyze, runTask.',
          });
      }
      return { nodeId: node.id, output, next: node.next };
    },
  };
}
