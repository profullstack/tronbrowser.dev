import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { CdpClient, CdpError } from './cdp-client.js';

// A tiny WebSocket server (handshake + single-frame text codec) so the CDP
// client is exercised over a real socket without pulling in a `ws` dependency.
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function decodeFrame(buf: Buffer): string | null {
  const opcode = buf[0] & 0x0f;
  if (opcode === 0x8) return null; // close
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    len = buf.readUInt16BE(2);
    offset = 4;
  }
  let mask: Buffer | null = null;
  if (masked) {
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }
  const payload = buf.subarray(offset, offset + len);
  const out = Buffer.alloc(len);
  for (let i = 0; i < len; i += 1) out[i] = mask ? payload[i] ^ mask[i % 4] : payload[i];
  return out.toString('utf8');
}

function encodeFrame(str: string): Buffer {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  if (len < 126) return Buffer.concat([Buffer.from([0x81, len]), payload]);
  const head = Buffer.alloc(4);
  head[0] = 0x81;
  head[1] = 126;
  head.writeUInt16BE(len, 2);
  return Buffer.concat([head, payload]);
}

type Handler = (msg: { id?: number; method?: string; params?: unknown }, socket: Socket) => void;

interface Mock {
  url: string;
  close: () => Promise<void>;
}

async function startMock(handler: Handler): Promise<Mock> {
  const server: Server = createServer();
  const sockets = new Set<Socket>();
  server.on('upgrade', (req, socket) => {
    sockets.add(socket as Socket);
    socket.on('close', () => sockets.delete(socket as Socket));
    const key = req.headers['sec-websocket-key'] ?? '';
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on('data', (buf: Buffer) => {
      const text = decodeFrame(buf);
      if (text === null) {
        socket.destroy(); // client close frame → drop the socket
        return;
      }
      handler(JSON.parse(text), socket as Socket);
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `ws://127.0.0.1:${port}/devtools/page/mock`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        sockets.clear();
        server.close(() => resolve());
      }),
  };
}

function reply(socket: Socket, obj: unknown): void {
  socket.write(encodeFrame(JSON.stringify(obj)));
}

let mock: Mock;
let client: CdpClient | undefined;

afterEach(async () => {
  client?.close();
  client = undefined;
  await mock.close();
});

describe('CdpClient over a WebSocket', () => {
  it('matches command responses by id', async () => {
    mock = await startMock((msg, socket) => {
      reply(socket, { id: msg.id, result: { echoed: msg.method } });
    });
    client = await CdpClient.connect(mock.url);
    const res = await client.send<{ echoed: string }>('Runtime.evaluate', { expression: '1' });
    expect(res.echoed).toBe('Runtime.evaluate');
  });

  it('rejects with CdpError on an error result', async () => {
    mock = await startMock((msg, socket) => {
      reply(socket, { id: msg.id, error: { code: -32000, message: 'no such target' } });
    });
    client = await CdpClient.connect(mock.url);
    const err = await client.send('Bad.method').catch((e) => e);
    expect(err).toBeInstanceOf(CdpError);
    expect(err.code).toBe(-32000);
    expect(err.message).toContain('no such target');
  });

  it('dispatches protocol events to on() handlers', async () => {
    mock = await startMock((msg, socket) => {
      // Reply, then emit an unsolicited event.
      reply(socket, { id: msg.id, result: {} });
      reply(socket, { method: 'Page.loadEventFired', params: { timestamp: 42 } });
    });
    client = await CdpClient.connect(mock.url);
    const event = new Promise<unknown>((resolve) => client!.on('Page.loadEventFired', resolve));
    await client.send('Page.enable');
    await expect(event).resolves.toEqual({ timestamp: 42 });
  });

  it('rejects pending commands when the connection closes', async () => {
    mock = await startMock(() => {
      /* never respond */
    });
    client = await CdpClient.connect(mock.url);
    const pending = client.send('Runtime.evaluate').catch((e) => e);
    client.close();
    const err = await pending;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/closed/);
  });
});
