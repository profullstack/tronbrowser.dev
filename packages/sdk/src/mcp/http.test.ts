import { afterAll, describe, expect, it } from 'vitest';
import { McpServer } from './protocol.js';
import { openMcpDescriptor, serveHttp, WELL_KNOWN_PATH, type HttpHandle } from './http.js';

function server(): McpServer {
  const s = new McpServer({ name: 'tronbrowser', version: '3.9' });
  s.register({
    name: 'echo',
    description: 'echo',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    handler: async (a) => [{ type: 'text', text: String(a.text ?? '') }],
  });
  return s;
}

const handles: HttpHandle[] = [];
afterAll(async () => {
  await Promise.all(handles.map((h) => h.close()));
});

async function listen(token?: string): Promise<HttpHandle> {
  const h = await serveHttp(server(), { port: 0, ...(token ? { token } : {}) });
  handles.push(h);
  return h;
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('openMcpDescriptor', () => {
  it('describes the relay the way an OpenMCP catalog reads it', () => {
    const d = openMcpDescriptor({ base: 'http://127.0.0.1:7333/', tools: ['fetch_page', 'browser_open'] });
    expect(d.openmcp).toBe('0.1');
    expect(d.mcp).toBe('http://127.0.0.1:7333/mcp');
    expect(d.name).toBe('TronBrowser');
    expect(d.url).toBe('https://tronbrowser.dev');
    expect(d.auth).toEqual({ kind: 'none', open: ['fetch_page', 'browser_open'] });
    expect(d.tools).toEqual(['fetch_page', 'browser_open']);
    expect(d.operator).toMatch(/openprofile\.md$/);
    expect(d.tags).toContain('browser');
  });
  it('switches to bearer auth when a token guards the endpoint', () => {
    const d = openMcpDescriptor({ base: 'http://h:1', tools: ['echo'], bearer: true, operator: 'https://x/.well-known/openprofile.md' });
    expect(d.auth).toEqual({ kind: 'bearer' });
    expect(d.operator).toBe('https://x/.well-known/openprofile.md');
  });
});

describe('serveHttp', () => {
  it('binds loopback, serves the descriptor and a health check', async () => {
    const h = await listen();
    expect(h.host).toBe('127.0.0.1');
    expect(h.url).toBe(`http://127.0.0.1:${h.port}`);
    const d = await (await fetch(`${h.url}${WELL_KNOWN_PATH}`)).json();
    expect(d.mcp).toBe(`${h.url}/mcp`);
    expect(d.tools).toEqual(['echo']);
    const health = await (await fetch(`${h.url}/healthz`)).json();
    expect(health.ok).toBe(true);
    expect((await fetch(`${h.url}/nope`)).status).toBe(404);
    expect((await fetch(`${h.url}/mcp`)).status).toBe(405);
  });

  it('runs the MCP handshake and a tool call over plain JSON', async () => {
    const h = await listen();
    const init = await post(h.url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    expect(init.status).toBe(200);
    expect(init.headers.get('content-type')).toContain('application/json');
    const initBody = await init.json();
    expect(initBody.result.serverInfo.name).toBe('tronbrowser');

    const note = await post(h.url, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(note.status).toBe(202);
    expect(await note.text()).toBe('');

    const list = await (await post(h.url, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['echo']);

    const call = await (await post(h.url, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } })).json();
    expect(call.result.content[0].text).toBe('hi');
  });

  it('answers batches, parse errors and bad requests as JSON-RPC', async () => {
    const h = await listen();
    const batch = await (await post(h.url, [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }, 7])).json();
    expect(Array.isArray(batch)).toBe(true);
    expect(batch).toHaveLength(2);
    expect(batch[0].result).toEqual({});
    expect(batch[1].error.code).toBe(-32600);
    const bad = await post(h.url, '{not json');
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe(-32700);
  });

  it('requires the bearer token when one is set, and says so in the descriptor', async () => {
    const h = await listen('s3cret');
    const d = await (await fetch(`${h.url}${WELL_KNOWN_PATH}`)).json();
    expect(d.auth.kind).toBe('bearer');
    expect((await post(h.url, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
    expect((await post(h.url, { jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'Bearer wrong' })).status).toBe(401);
    const ok = await post(h.url, { jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'Bearer s3cret' });
    expect(ok.status).toBe(200);
  });

  it('answers CORS preflight so a browser-hosted MCP client can reach it', async () => {
    const h = await listen();
    const r = await fetch(`${h.url}/mcp`, { method: 'OPTIONS' });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-methods')).toContain('POST');
  });
});
