import { describe, expect, it } from 'vitest';
import type { ExecutionContext, Workflow } from './index.js';
import type { WorkflowBrowser, WorkflowPage } from './nodes/browser.js';
import { browserHandlers, exportWorkflowJson, runWorkflow } from './runner.js';

const SNAP = { url: 'https://x/', title: 'X', timestamp: 't', elements: [] };

function browser(overrides: Partial<WorkflowPage> = {}) {
  let closed = false;
  const page: WorkflowPage = {
    goto: async () => {},
    snapshot: async () => SNAP,
    click: async () => {},
    fill: async () => {},
    extract: async () => ({ links: [{ text: 'A', href: 'https://x/a' }] }),
    screenshot: async () => Buffer.from('PNG'),
    analyze: async () => ({ ok: true, mode: 'dry-run', status: 'planned', page: { url: 'x', title: 'X' } }),
    runTask: async () => ({ ok: true, mode: 'execute', status: 'complete', page: { url: 'x', title: 'X' } }),
    ...overrides,
  };
  const b: WorkflowBrowser = { page: async () => page, writeBytes: async () => {}, close: async () => { closed = true; } };
  return { browser: b, isClosed: () => closed };
}

const workflow: Workflow = {
  id: 'wf', name: 'lead scrape', entry: 'open',
  nodes: {
    open: { id: 'open', type: 'browser', next: ['grab'], config: { action: 'open', url: 'https://x/' } },
    grab: { id: 'grab', type: 'browser', next: [], config: { action: 'extract', mode: 'links' } },
  },
};

function ctx(): ExecutionContext {
  return { variables: {} };
}

describe('runWorkflow', () => {
  it('runs the graph, threads outputs, and closes the browser', async () => {
    const b = browser();
    const c = ctx();
    const result = await runWorkflow(workflow, c, browserHandlers(b.browser));
    expect(result.ok).toBe(true);
    expect(result.results.open.output).toEqual(SNAP);
    expect((result.results.grab.output as { links: unknown[] }).links).toHaveLength(1);
    expect(c.variables.grab).toBeDefined(); // outputs threaded into context
    expect(b.isClosed()).toBe(true); // onClose ran
  });

  it('exports the run result as JSON', () => {
    const json = exportWorkflowJson({ ok: true, results: {} });
    expect(JSON.parse(json).ok).toBe(true);
  });

  it('stops on a failing node with recovery details, and still closes', async () => {
    const b = browser({
      click: async () => {
        throw Object.assign(new Error('Ref @e9 not found'), { code: 'STALE_REF', recoverable: true });
      },
    });
    const wf: Workflow = {
      id: 'wf', name: 'x', entry: 'a',
      nodes: {
        a: { id: 'a', type: 'browser', next: ['b'], config: { action: 'open', url: 'https://x/' } },
        b: { id: 'b', type: 'browser', next: [], config: { action: 'click', ref: '@e9' } },
      },
    };
    const result = await runWorkflow(wf, ctx(), browserHandlers(b.browser));
    expect(result.ok).toBe(false);
    expect(result.failure!.nodeId).toBe('b');
    expect(result.failure!.recovery.recoverable).toBe(true);
    expect(result.failure!.recovery.suggestion).toMatch(/snapshot/i);
    expect(result.results.a).toBeDefined(); // the first node still ran
    expect(b.isClosed()).toBe(true);
  });

  it('fails cleanly when no handler is registered for a node type', async () => {
    const wf: Workflow = {
      id: 'wf', name: 'x', entry: 'a',
      nodes: { a: { id: 'a', type: 'ai', next: [], config: { provider: 'anthropic', model: 'claude' } } },
    };
    const result = await runWorkflow(wf, ctx(), { handlers: new Map() });
    expect(result.ok).toBe(false);
    expect(result.failure!.error).toMatch(/no handler/);
  });
});
