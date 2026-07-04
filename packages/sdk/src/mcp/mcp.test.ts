import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { AgentSnapshot } from '@tronbrowser/browser-core';
import { McpServer } from './protocol.js';
import { McpBrowserSession, type McpPage } from './session.js';
import { createMcpServer, serveStdio } from './server.js';

const SNAP: AgentSnapshot = {
  url: 'https://x/', title: 'X', timestamp: 't',
  elements: [{ ref: '@e1', role: 'link', name: 'More', tag: 'a', interactive: true, visible: true }],
};

function fakePage() {
  const calls: string[] = [];
  const page: McpPage = {
    id: 'p1',
    goto: async (u) => { calls.push('goto:' + u); },
    snapshot: async () => SNAP,
    click: async (r) => { calls.push('click:' + r); },
    fill: async (r, v) => { calls.push('fill:' + r + '=' + v); },
    extract: async (m) => ({ mode: m }),
    screenshot: async () => Buffer.from('PNG'),
    eval: async () => { calls.push('eval'); return null as never; },
    url: async () => 'https://x/',
    title: async () => 'X',
    analyze: async (g) => ({ ok: true, mode: 'dry-run', status: 'planned', page: { url: 'x', title: 'X' }, ...(g ? { goal: g } : {}) }),
    step: async () => ({ ok: true, mode: 'execute', status: 'acted', page: { url: 'x', title: 'X' } }),
    runTask: async () => ({ ok: true, mode: 'execute', status: 'complete', page: { url: 'x', title: 'X' } }),
  };
  return { page, calls };
}

function harness() {
  const { page, calls } = fakePage();
  let closed = false;
  const session = new McpBrowserSession(async () => ({ page, close: async () => { closed = true; } }));
  const server = createMcpServer(session);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return { server, call, calls, isClosed: () => closed };
}

describe('MCP protocol', () => {
  const { server } = harness();
  it('handles initialize with capabilities + serverInfo', async () => {
    const r = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    expect((r!.result as { serverInfo: { name: string } }).serverInfo.name).toBe('tronbrowser');
    expect((r!.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');
    expect((r!.result as { capabilities: { tools: unknown } }).capabilities.tools).toBeDefined();
  });
  it('lists all browser tools', async () => {
    const r = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = (r!.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'browser_open', 'browser_snapshot', 'browser_click', 'browser_fill', 'browser_extract',
      'browser_screenshot', 'browser_tabs', 'browser_close', 'browser_analyze', 'browser_step', 'browser_run_task',
    ]));
  });
  it('returns null for a notification (no id)', async () => {
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });
  it('answers ping and errors on unknown method', async () => {
    expect((await server.handle({ jsonrpc: '2.0', id: 3, method: 'ping' }))!.result).toEqual({});
    const e = await server.handle({ jsonrpc: '2.0', id: 4, method: 'nope' });
    expect(e!.error!.code).toBe(-32601);
  });
});

describe('MCP tools', () => {
  it('browser_open navigates and returns a fresh snapshot', async () => {
    const { call, calls } = harness();
    const r = await call('browser_open', { url: 'https://x/' });
    expect(calls).toContain('goto:https://x/');
    expect((r!.result as { content: Array<{ text: string }> }).content[0].text).toContain('@e1 link "More"');
  });
  it('browser_click / browser_fill act then return a snapshot', async () => {
    const { call, calls } = harness();
    await call('browser_click', { ref: '@e1' });
    await call('browser_fill', { ref: '@e2', value: 'hi' });
    expect(calls).toContain('click:@e1');
    expect(calls).toContain('fill:@e2=hi');
  });
  it('browser_screenshot returns image content', async () => {
    const { call } = harness();
    const r = await call('browser_screenshot');
    const content = (r!.result as { content: Array<{ type: string; data: string; mimeType: string }> }).content[0];
    expect(content.type).toBe('image');
    expect(content.mimeType).toBe('image/png');
    expect(Buffer.from(content.data, 'base64').toString()).toBe('PNG');
  });
  it('browser_analyze returns a dry-run result', async () => {
    const { call } = harness();
    const r = await call('browser_analyze', { goal: 'Fill form' });
    const parsed = JSON.parse((r!.result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.status).toBe('planned');
    expect(parsed.goal).toBe('Fill form');
  });
  it('browser_close closes an opened session', async () => {
    const { call, isClosed } = harness();
    await call('browser_snapshot'); // opens the session
    await call('browser_close');
    expect(isClosed()).toBe(true);
  });
  it('reports isError for an unknown tool', async () => {
    const { call } = harness();
    const r = await call('browser_bogus');
    expect((r!.result as { isError: boolean }).isError).toBe(true);
  });
});

describe('MCP stdio transport', () => {
  it('reads newline-delimited requests and writes responses', async () => {
    const server = new McpServer({ name: 'tronbrowser', version: '3.7' });
    const out: string[] = [];
    await serveStdio(server, {
      input: Readable.from([
        '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n',
        '{"jsonrpc":"2.0","method":"notifications/initialized"}\n',
        '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
      ]),
      write: (line) => out.push(line.trim()),
    });
    // one response for initialize, none for the notification, one for tools/list
    expect(out).toHaveLength(2);
    expect(JSON.parse(out[0]).id).toBe(1);
    expect(JSON.parse(out[1]).id).toBe(2);
  });
});
