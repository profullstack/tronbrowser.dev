// End-to-end: the SDK drives a page over a REAL CdpClient/WebSocket against a
// mock DevTools server. Only the session launch is faked (no real browser); the
// fetch + CDP transport are real, covering newPage() connect and Page ops.
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionDescriptor } from '@tronbrowser/browser-core';
import { tron } from './index.js';
import { defaultDeps, type SdkDeps } from './deps.js';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const SNAP = { url: 'https://example.com/', title: 'Example', timestamp: 't', elements: [] };

function decode(b: Buffer): string | null {
  if ((b[0] & 0x0f) === 0x8) return null;
  const masked = (b[1] & 0x80) !== 0;
  let len = b[1] & 0x7f; let o = 2;
  if (len === 126) { len = b.readUInt16BE(2); o = 4; }
  let mask: Buffer | null = null;
  if (masked) { mask = b.subarray(o, o + 4); o += 4; }
  const p = b.subarray(o, o + len); const out = Buffer.alloc(len);
  for (let i = 0; i < len; i += 1) out[i] = mask ? p[i] ^ mask[i % 4] : p[i];
  return out.toString('utf8');
}
function encode(s: string): Buffer {
  const p = Buffer.from(s);
  if (p.length < 126) return Buffer.concat([Buffer.from([0x81, p.length]), p]);
  const h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2);
  return Buffer.concat([h, p]);
}

interface Mock { port: number; close: () => Promise<void> }

async function startMock(): Promise<Mock> {
  const sockets = new Set<Socket>();
  const pages = ['p1'];
  const server: Server = createServer((req, res) => {
    const port = (server.address() as { port: number }).port;
    if (req.url === '/json/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/b` }));
      return;
    }
    if (req.url === '/json' || req.url === '/json/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(pages.map((id) => ({ id, type: 'page', url: 'https://example.com/', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${id}` }))));
      return;
    }
    res.writeHead(404).end();
  });
  server.on('upgrade', (req, socket) => {
    sockets.add(socket as Socket);
    socket.on('close', () => sockets.delete(socket as Socket));
    const accept = createHash('sha1').update((req.headers['sec-websocket-key'] ?? '') + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.on('data', (buf: Buffer) => {
      const t = decode(buf);
      if (t === null) { socket.destroy(); return; }
      const m = JSON.parse(t) as { id: number; method: string };
      let result: Record<string, unknown> = {};
      if (m.method === 'Runtime.evaluate') result = { result: { result: { value: SNAP } } };
      else if (m.method === 'Target.createTarget') { pages.push('p2'); result = { result: { targetId: 'p2' } }; }
      socket.write(encode(JSON.stringify({ id: m.id, ...result })));
      if (m.method === 'Page.navigate') socket.write(encode(JSON.stringify({ method: 'Page.loadEventFired', params: {} })));
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as { port: number }).port,
    close: () => new Promise<void>((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}

/** Deps with a real transport but a faked (browser-less) session. */
function mockDeps(port: number): SdkDeps {
  const descriptor: SessionDescriptor = {
    version: 1, pid: 1, host: '127.0.0.1', port, profileDir: '/x', profileName: 'ephemeral',
    headless: true, ephemeral: true, createdAt: 't',
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/b`,
  };
  return {
    ...defaultDeps,
    makeDataDir: async () => '/tmp/sdk-e2e',
    removeDataDir: async () => {},
    launchSession: async () => {},
    closeSession: async () => {},
    loadDescriptor: async () => descriptor,
  };
}

let mock: Mock;
afterEach(async () => { await mock.close(); });

describe('SDK over the real CDP transport', () => {
  it('launches, opens a page, navigates, and snapshots', async () => {
    mock = await startMock();
    const browser = await tron.launch({ headless: true }, mockDeps(mock.port));
    const page = await browser.newPage();
    await page.goto('https://example.com');
    expect((await page.snapshot()).title).toBe('Example');
    await browser.close();
  });

  it('opens a second page via Target.createTarget', async () => {
    mock = await startMock();
    const browser = await tron.launch({}, mockDeps(mock.port));
    const p1 = await browser.newPage();
    const p2 = await browser.newPage();
    expect(p1.id).toBe('p1');
    expect(p2.id).toBe('p2');
    expect(browser.pages()).toHaveLength(2);
    await browser.close();
  });
});
