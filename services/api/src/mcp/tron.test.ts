import { describe, expect, it } from 'vitest';
import type { FetchArgs } from '@tronbrowser/sdk';
import { tronRelay, MAX_CHARS_CAP, MAX_TIMEOUT_S } from './tron.js';

const publicDns = async () => ['93.184.216.34'];

function relay(over: Parameters<typeof tronRelay>[0] = {}) {
  const fetched: FetchArgs[] = [];
  let release: (() => void) | undefined;
  const r = tronRelay({
    lookup: publicDns,
    log: () => {},
    fetch: async (args) => {
      fetched.push(args);
      if (args.url.includes('slow')) await new Promise<void>((res) => { release = res; });
      return { text: `page ${args.url}`, outcome: { engine: 'obscura', url: args.url, format: args.format, ms: 5, chars: 10 } };
    },
    screenshot: async () => Buffer.from('PNG'),
    ...over,
  });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    r.app.request('/', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const call = async (name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) => {
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, headers);
    return (await res.json()).result as { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean };
  };
  return { ...r, post, call, fetched, release: () => release?.() };
}

describe('tronbrowser.dev/mcp/tron', () => {
  it('describes itself on GET and lists only the stateless tools', async () => {
    const r = relay();
    const res = await r.app.request('/');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.descriptor).toBe('https://tronbrowser.dev/.well-known/openmcp.json');
    expect(body.tools).toEqual(['fetch_page', 'screenshot_page']);
    const list = await (await r.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['fetch_page', 'screenshot_page']);
  });

  it('runs the MCP handshake over plain JSON and answers notifications with 202', async () => {
    const r = relay();
    const init = await r.post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe('tronbrowser');
    expect((await r.post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    expect((await r.post('{oops')).status).toBe(400);
    const batch = await (await r.post([{ jsonrpc: '2.0', id: 1, method: 'ping' }, 5])).json();
    expect(batch).toHaveLength(2);
    expect(batch[1].error.code).toBe(-32600);
  });

  it('fetch_page returns the page and the outcome line', async () => {
    const r = relay();
    const out = await r.call('fetch_page', { url: 'https://example.com/', format: 'text' });
    expect(out.isError).toBeUndefined();
    expect(out.content[0]!.text).toBe('page https://example.com/');
    expect(JSON.parse(out.content[1]!.text!)).toMatchObject({ engine: 'obscura', format: 'text' });
    expect(r.fetched[0]).toMatchObject({ url: 'https://example.com/', format: 'text', engine: 'auto' });
  });

  it('caps max_chars and the Obscura budget for a public caller', async () => {
    const r = relay();
    await r.call('fetch_page', { url: 'https://example.com/', max_chars: 10_000_000, timeout_s: 600 });
    expect(r.fetched[0]!.maxChars).toBe(MAX_CHARS_CAP);
    expect(r.fetched[0]!.budgetMs).toBe(MAX_TIMEOUT_S * 1000);
  });

  it('refuses private targets before touching an engine', async () => {
    const r = relay();
    for (const url of ['http://localhost:8090/api/healthz', 'http://169.254.169.254/', 'http://10.0.0.1/', 'file:///etc/passwd']) {
      const out = await r.call('fetch_page', { url });
      expect(out.isError, url).toBe(true);
    }
    const shot = await r.call('screenshot_page', { url: 'http://127.0.0.1/' });
    expect(shot.isError).toBe(true);
    expect(r.fetched).toHaveLength(0);
  });

  it('refuses a name that resolves to a private address', async () => {
    const r = relay({ lookup: async () => ['10.9.9.9'] });
    const out = await r.call('fetch_page', { url: 'https://rebind.example/' });
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toMatch(/private address/);
  });

  it('screenshot_page returns PNG image content', async () => {
    const r = relay();
    const out = await r.call('screenshot_page', { url: 'https://example.com/' });
    const img = out.content[0]!;
    expect(img.type).toBe('image');
    expect(Buffer.from(img.data!, 'base64').toString()).toBe('PNG');
  });

  it('rate-limits tool calls per caller address, not the handshake', async () => {
    let t = 0;
    const r = relay({ rate: { burst: 2, perMinute: 60 }, now: () => t });
    const a = { 'x-forwarded-for': '203.0.113.1' };
    expect((await r.call('fetch_page', { url: 'https://example.com/' }, a)).isError).toBeUndefined();
    expect((await r.call('fetch_page', { url: 'https://example.com/' }, a)).isError).toBeUndefined();
    const third = await r.call('fetch_page', { url: 'https://example.com/' }, a);
    expect(third.isError).toBe(true);
    expect(third.content[0]!.text).toMatch(/Rate limited/);
    // Another caller and the handshake are unaffected.
    expect((await r.call('fetch_page', { url: 'https://example.com/' }, { 'x-forwarded-for': '203.0.113.2' })).isError).toBeUndefined();
    expect((await r.post({ jsonrpc: '2.0', id: 9, method: 'ping' }, a)).status).toBe(200);
    t += 1000;
    expect((await r.call('fetch_page', { url: 'https://example.com/' }, a)).isError).toBeUndefined();
  });

  it('answers Busy past the concurrency cap instead of queueing', async () => {
    const r = relay({ maxConcurrent: 1 });
    const slow = r.call('fetch_page', { url: 'https://slow.example/' });
    await new Promise((res) => setTimeout(res, 10));
    const busy = await r.call('fetch_page', { url: 'https://example.com/' });
    expect(busy.isError).toBe(true);
    expect(busy.content[0]!.text).toMatch(/Busy/);
    r.release();
    expect((await slow).isError).toBeUndefined();
    expect((await r.call('fetch_page', { url: 'https://example.com/' })).isError).toBeUndefined();
  });

  it('rejects oversized bodies', async () => {
    const r = relay();
    const res = await r.post({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(1024 * 1024 + 1) } });
    expect(res.status).toBe(413);
  });
});
