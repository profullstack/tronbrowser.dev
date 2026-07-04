// End-to-end: drive the automation CLI with its REAL default deps (global fetch
// + real CdpClient over a real WebSocket) against a mock DevTools server. This
// covers the glue the unit tests exercise only in isolation: descriptor ->
// /json/list -> page WS -> Runtime.evaluate -> formatted output. The in-page
// scripts themselves are verified against a real DOM in snapshot-script.test.ts,
// so here the mock returns canned evaluate results.
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT, run } from './automate-cli.js';
import { serializeDescriptor } from './automation/descriptor.js';
import type { SessionDescriptor } from './automation/types.js';
import type { AgentSnapshot } from './automation/snapshot-script.js';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function decodeFrame(buf: Buffer): string | null {
  if ((buf[0] & 0x0f) === 0x8) return null;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
  let mask: Buffer | null = null;
  if (masked) { mask = buf.subarray(off, off + 4); off += 4; }
  const p = buf.subarray(off, off + len);
  const out = Buffer.alloc(len);
  for (let i = 0; i < len; i += 1) out[i] = mask ? p[i] ^ mask[i % 4] : p[i];
  return out.toString('utf8');
}
function encodeFrame(str: string): Buffer {
  const p = Buffer.from(str, 'utf8');
  if (p.length < 126) return Buffer.concat([Buffer.from([0x81, p.length]), p]);
  const h = Buffer.alloc(4);
  h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2);
  return Buffer.concat([h, p]);
}

interface Mock {
  port: number;
  close: () => Promise<void>;
}

/** Mock DevTools server: HTTP /json/list + a page WS that answers Runtime.*.
 * `evaluate` supplies Runtime.evaluate values; `methodResults` supplies command
 * results for other CDP methods (e.g. Page.captureScreenshot). */
async function startMock(
  evaluate: (expression: string) => unknown,
  methodResults: Record<string, unknown> = {},
): Promise<Mock> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((req, res) => {
    if (req.url === '/json/list') {
      const port = (server.address() as { port: number }).port;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify([
          { id: 'p1', type: 'page', url: 'https://example.com', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/p1` },
        ]),
      );
      return;
    }
    res.writeHead(404).end();
  });
  server.on('upgrade', (req, socket) => {
    sockets.add(socket as Socket);
    socket.on('close', () => sockets.delete(socket as Socket));
    const accept = createHash('sha1').update((req.headers['sec-websocket-key'] ?? '') + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on('data', (buf: Buffer) => {
      const text = decodeFrame(buf);
      if (text === null) { socket.destroy(); return; }
      const msg = JSON.parse(text) as { id: number; method: string; params?: { expression?: string } };
      // Real CDP nests twice: {result: {result: <RemoteObject>, exceptionDetails?}}.
      let result: Record<string, unknown> = {};
      if (msg.method === 'Runtime.evaluate') {
        result = { result: { result: { value: evaluate(msg.params?.expression ?? '') } } };
      } else if (msg.method in methodResults) {
        result = { result: methodResults[msg.method] };
      }
      socket.write(encodeFrame(JSON.stringify({ id: msg.id, ...result })));
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as { port: number }).port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

const snap: AgentSnapshot = {
  url: 'https://example.com/contact',
  title: 'Contact Us',
  timestamp: '2026-07-04T00:00:00.000Z',
  elements: [
    { ref: '@e1', role: 'textbox', name: 'Email', tag: 'input', interactive: true, visible: true },
  ],
};

let mock: Mock;
let dataDir: string;

function writeDescriptor(port: number): void {
  const d: SessionDescriptor = {
    version: 1, pid: process.pid, host: '127.0.0.1', port,
    profileDir: '/x', profileName: 'agent', headless: false, ephemeral: false,
    createdAt: '2026-07-04T00:00:00.000Z', activeTabId: 'p1',
  };
  mkdirSync(join(dataDir, 'automation'), { recursive: true });
  writeFileSync(join(dataDir, 'automation', 'session.json'), serializeDescriptor(d));
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'automate-e2e-'));
});
afterEach(async () => {
  await mock.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('automation CLI end-to-end over HTTP + WebSocket', () => {
  it('snapshots the current page through the real transport', async () => {
    mock = await startMock(() => snap);
    writeDescriptor(mock.port);
    const out: string[] = [];
    const code = await run(['snapshot'], { env: { TRONBROWSER_DATA: dataDir }, out: (t) => out.push(t) });
    expect(code).toBe(EXIT.ok);
    expect(out.join('\n')).toContain('@e1 textbox "Email"');
  });

  it('clicks a ref end-to-end', async () => {
    mock = await startMock(() => ({ ok: true, ref: '@e1' }));
    writeDescriptor(mock.port);
    const out: string[] = [];
    const code = await run(['click', '@e1'], { env: { TRONBROWSER_DATA: dataDir }, out: (t) => out.push(t) });
    expect(code).toBe(EXIT.ok);
    expect(out.join('\n')).toContain('clicked @e1');
  });

  it('returns staleRef end-to-end when the ref is gone', async () => {
    mock = await startMock(() => ({ ok: false, error: 'STALE_REF', ref: '@e9' }));
    writeDescriptor(mock.port);
    const err: string[] = [];
    const code = await run(['click', '@e9'], { env: { TRONBROWSER_DATA: dataDir }, err: (t) => err.push(t) });
    expect(code).toBe(EXIT.staleRef);
    expect(err.join('\n')).toMatch(/stale/i);
  });

  it('extracts links end-to-end', async () => {
    mock = await startMock(() => [{ text: 'More', href: 'https://example.com/more' }]);
    writeDescriptor(mock.port);
    const out: string[] = [];
    const code = await run(['extract', 'links'], { env: { TRONBROWSER_DATA: dataDir }, out: (t) => out.push(t) });
    expect(code).toBe(EXIT.ok);
    expect(JSON.parse(out.join('\n'))[0].href).toBe('https://example.com/more');
  });

  it('captures a screenshot end-to-end', async () => {
    mock = await startMock(() => null, {
      'Page.captureScreenshot': { data: Buffer.from('PNGBYTES').toString('base64') },
    });
    writeDescriptor(mock.port);
    let written: Uint8Array | undefined;
    const code = await run(['screenshot', 'out.png'], {
      env: { TRONBROWSER_DATA: dataDir },
      out: () => {},
      writeBytes: async (_p, bytes) => {
        written = bytes;
      },
    });
    expect(code).toBe(EXIT.ok);
    expect(Buffer.from(written!).toString()).toBe('PNGBYTES');
  });
});
