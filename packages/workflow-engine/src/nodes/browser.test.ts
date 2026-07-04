import { describe, expect, it } from 'vitest';
import type { BrowserNode, ExecutionContext } from '../index.js';
import { BrowserNodeError, createBrowserNodeHandler, type WorkflowBrowser, type WorkflowPage } from './browser.js';

const SNAP = { url: 'https://x/', title: 'X', timestamp: 't', elements: [] };

function fakePage() {
  const calls: string[] = [];
  const page: WorkflowPage = {
    goto: async (u) => { calls.push('goto:' + u); },
    snapshot: async () => SNAP,
    click: async (r) => { calls.push('click:' + r); },
    fill: async (r, v) => { calls.push('fill:' + r + '=' + v); },
    extract: async (m) => ({ mode: m }),
    screenshot: async () => Buffer.from('PNG'),
    analyze: async (g) => ({ ok: true, mode: 'dry-run', status: 'planned', page: { url: 'x', title: 'X' }, ...(g ? { goal: g } : {}) }),
    runTask: async () => ({ ok: true, mode: 'execute', status: 'complete', page: { url: 'x', title: 'X' } }),
  };
  return { page, calls };
}

function fakeBrowser(page: WorkflowPage) {
  const writes: Array<{ path: string; bytes: Uint8Array }> = [];
  let closed = false;
  const browser: WorkflowBrowser = {
    page: async () => page,
    writeBytes: async (path, bytes) => { writes.push({ path, bytes }); },
    close: async () => { closed = true; },
  };
  return { browser, writes, isClosed: () => closed };
}

const ctx: ExecutionContext = { variables: {} };
const node = (config: BrowserNode['config']): BrowserNode => ({ id: 'n', type: 'browser', next: [], config });

describe('browser node handler', () => {
  it('open navigates and outputs a snapshot', async () => {
    const { page, calls } = fakePage();
    const h = createBrowserNodeHandler(fakeBrowser(page).browser);
    const r = await h.run(node({ action: 'open', url: 'https://x/' }), ctx);
    expect(calls).toContain('goto:https://x/');
    expect((r.output as typeof SNAP).title).toBe('X');
  });

  it('click and fill act then output a snapshot', async () => {
    const { page, calls } = fakePage();
    const h = createBrowserNodeHandler(fakeBrowser(page).browser);
    await h.run(node({ action: 'click', ref: '@e1' }), ctx);
    await h.run(node({ action: 'fill', ref: '@e2', value: 'hi' }), ctx);
    expect(calls).toEqual(expect.arrayContaining(['click:@e1', 'fill:@e2=hi']));
  });

  it('extract outputs data', async () => {
    const { page } = fakePage();
    const h = createBrowserNodeHandler(fakeBrowser(page).browser);
    const r = await h.run(node({ action: 'extract', mode: 'links' }), ctx);
    expect(r.output).toEqual({ mode: 'links' });
  });

  it('screenshot writes the file and outputs its path', async () => {
    const { page } = fakePage();
    const fb = fakeBrowser(page);
    const h = createBrowserNodeHandler(fb.browser);
    const r = await h.run(node({ action: 'screenshot', path: 'out.png' }), ctx);
    expect(fb.writes[0].path).toBe('out.png');
    expect(r.output).toEqual({ screenshot: 'out.png' });
  });

  it('analyze outputs a dry-run result', async () => {
    const { page } = fakePage();
    const h = createBrowserNodeHandler(fakeBrowser(page).browser);
    const r = await h.run(node({ action: 'analyze', goal: 'Fill form' }), ctx);
    expect((r.output as { status: string; goal: string }).status).toBe('planned');
    expect((r.output as { goal: string }).goal).toBe('Fill form');
  });

  it('throws a non-recoverable BrowserNodeError when a required field is missing', async () => {
    const { page } = fakePage();
    const h = createBrowserNodeHandler(fakeBrowser(page).browser);
    const err = await h.run(node({ action: 'click' }), ctx).catch((e) => e);
    expect(err).toBeInstanceOf(BrowserNodeError);
    expect(err.recovery.recoverable).toBe(false);
  });
});
