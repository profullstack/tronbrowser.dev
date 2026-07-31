/**
 * Browser tools exposed over MCP (PRD §14). Primitive tools plus the AI-assisted
 * browser_analyze / browser_step / browser_run_task. Mutating tools return a
 * fresh snapshot (PRD §10). All action on the managed session's current page.
 */
import { formatSnapshotText, type AgentSnapshot } from '@tronbrowser/browser-core';
import type { McpContent, McpTool } from './protocol.js';
import type { McpBrowserSession, McpPage } from './session.js';

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v === undefined ? fallback : String(v));
const snapshotContent = (snap: AgentSnapshot): McpContent[] => [{ type: 'text', text: formatSnapshotText(snap) }];
const jsonContent = (data: unknown): McpContent[] => [{ type: 'text', text: JSON.stringify(data, null, 2) }];

async function freshSnapshot(page: McpPage): Promise<McpContent[]> {
  return snapshotContent(await page.snapshot());
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const,
  properties,
  ...(required.length ? { required } : {}),
});

export function browserTools(session: McpBrowserSession): McpTool[] {
  const page = () => session.getPage();
  return [
    {
      name: 'browser_open',
      description: 'Open a URL in the managed session and return a page snapshot.',
      inputSchema: obj({ url: { type: 'string' } }, ['url']),
      handler: async (a) => {
        const p = await page();
        await p.goto(str(a.url));
        return freshSnapshot(p);
      },
    },
    {
      name: 'browser_snapshot',
      description: 'Return a structured, ref-tagged snapshot of the current page.',
      inputSchema: obj({}),
      handler: async () => snapshotContent(await (await page()).snapshot()),
    },
    {
      name: 'browser_click',
      description: 'Click a snapshot ref (e.g. @e3) and return a fresh snapshot.',
      inputSchema: obj({ ref: { type: 'string' } }, ['ref']),
      handler: async (a) => {
        const p = await page();
        await p.click(str(a.ref));
        return freshSnapshot(p);
      },
    },
    {
      name: 'browser_fill',
      description: 'Fill an input by ref with a value; returns a fresh snapshot.',
      inputSchema: obj({ ref: { type: 'string' }, value: { type: 'string' } }, ['ref', 'value']),
      handler: async (a) => {
        const p = await page();
        await p.fill(str(a.ref), str(a.value));
        return freshSnapshot(p);
      },
    },
    {
      name: 'browser_type',
      description: 'Type text into an input by ref (alias of fill).',
      inputSchema: obj({ ref: { type: 'string' }, value: { type: 'string' } }, ['ref', 'value']),
      handler: async (a) => {
        const p = await page();
        await p.fill(str(a.ref), str(a.value));
        return freshSnapshot(p);
      },
    },
    {
      name: 'browser_press',
      description: 'Dispatch a key press (e.g. Enter) to the focused element.',
      inputSchema: obj({ key: { type: 'string' } }, ['key']),
      handler: async (a) => {
        const p = await page();
        const key = JSON.stringify(str(a.key));
        await p.eval(`(() => { const el = document.activeElement || document.body; for (const t of ['keydown','keyup']) el.dispatchEvent(new KeyboardEvent(t, { key: ${key}, bubbles: true, cancelable: true })); })()`);
        return freshSnapshot(p);
      },
    },
    {
      name: 'browser_select',
      description: 'Select an option by value in a <select> referenced by ref.',
      inputSchema: obj({ ref: { type: 'string' }, value: { type: 'string' } }, ['ref', 'value']),
      handler: async (a) => {
        const p = await page();
        const ref = JSON.stringify(str(a.ref).replace(/^@/, ''));
        const value = JSON.stringify(str(a.value));
        await p.eval(`(() => { const el = document.querySelector('[data-tron-ref=' + ${JSON.stringify(ref)} + ']'); if (el) { el.value = ${value}; el.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
        return freshSnapshot(p);
      },
    },
    {
      name: 'browser_scroll',
      description: 'Scroll the page by a pixel amount (positive = down).',
      inputSchema: obj({ amount: { type: 'number' } }),
      handler: async (a) => {
        const p = await page();
        const amount = typeof a.amount === 'number' ? a.amount : 600;
        await p.eval(`window.scrollBy(0, ${amount})`);
        return freshSnapshot(p);
      },
    },
    {
      name: 'browser_wait',
      description: 'Wait for a number of milliseconds.',
      inputSchema: obj({ ms: { type: 'number' } }),
      handler: async (a) => {
        const ms = Math.min(typeof a.ms === 'number' ? a.ms : 500, 15000);
        await new Promise((r) => setTimeout(r, ms));
        return [{ type: 'text', text: `Waited ${ms}ms.` }];
      },
    },
    {
      name: 'browser_extract',
      description: 'Extract structured JSON: text|links|forms|tables|main or a CSS selector.',
      inputSchema: obj({ mode: { type: 'string' } }),
      handler: async (a) => jsonContent(await (await page()).extract(str(a.mode, 'text'))),
    },
    {
      name: 'browser_screenshot',
      description: 'Capture a PNG screenshot of the current page.',
      inputSchema: obj({}),
      handler: async () => {
        const png = await (await page()).screenshot();
        return [{ type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' }];
      },
    },
    {
      name: 'browser_tabs',
      description: 'List the managed session tabs.',
      inputSchema: obj({}),
      handler: async () => jsonContent(await session.tabs()),
    },
    {
      name: 'browser_close',
      description: 'Close the managed browser session.',
      inputSchema: obj({}),
      handler: async () => {
        await session.close();
        return [{ type: 'text', text: 'Session closed.' }];
      },
    },
    {
      name: 'browser_analyze',
      description: 'Non-mutating: analyze the page / map a form to data. Dry-run.',
      inputSchema: obj({ goal: { type: 'string' }, data: { type: 'object' }, mode: { type: 'string' } }),
      handler: async (a) => {
        const p = await page();
        const goal = a.goal !== undefined ? str(a.goal) : undefined;
        return jsonContent(await p.analyze(goal, { ...(a.data !== undefined ? { data: a.data } : {}) }));
      },
    },
    {
      name: 'browser_step',
      description: 'Execute one validated AI-selected action toward a goal.',
      inputSchema: obj({ goal: { type: 'string' }, data: { type: 'object' } }, ['goal']),
      handler: async (a) => {
        const p = await page();
        return jsonContent(await p.step(str(a.goal), { ...(a.data !== undefined ? { data: a.data } : {}) }));
      },
    },
    {
      name: 'browser_run_task',
      description: 'Run a bounded unknown-interface task toward a goal.',
      inputSchema: obj({ goal: { type: 'string' }, data: { type: 'object' }, maxSteps: { type: 'number' } }, ['goal']),
      handler: async (a) => {
        const p = await page();
        return jsonContent(
          await p.runTask(str(a.goal), {
            ...(a.data !== undefined ? { data: a.data } : {}),
            ...(typeof a.maxSteps === 'number' ? { maxSteps: a.maxSteps } : {}),
          }),
        );
      },
    },
  ];
}
