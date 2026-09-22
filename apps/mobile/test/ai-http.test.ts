import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_TIMEOUT_MS, sendChat } from '../src/lib/ai';

const history = [{ id: 'local-only', role: 'user' as const, text: 'hello' }];
afterEach(() => vi.unstubAllEnvs());

async function expectClosed(closed: Promise<unknown>) {
  expect(closed).toBeDefined();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      closed,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Response still open after client returned')),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function withServer(
  handler: (response: ServerResponse) => void,
  check: (
    requests: { method?: string; path?: string; body: string }[],
  ) => Promise<void>,
) {
  const requests: { method?: string; path?: string; body: string }[] = [];
  const server = createServer(async (request, response) => {
    try {
      request.setEncoding('utf8');
      let body = '';
      for await (const chunk of request) body += String(chunk);
      requests.push({ method: request.method, path: request.url, body });
      handler(response);
    } catch {
      response.destroy();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  vi.stubEnv('EXPO_PUBLIC_AI_ENDPOINT', `http://127.0.0.1:${address.port}/`);
  try {
    await check(requests);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe('chat using real loopback HTTP and AbortController', () => {
  it('sends one POST with public conversation fields and decodes UTF-8', async () => {
    await withServer(
      (response) => {
        response.setHeader('content-type', 'application/json');
        const bytes = Buffer.from(
          JSON.stringify({ text: '\u0111\u00e3 nh\u1eadn' }),
        );
        for (const byte of bytes) response.write(Buffer.from([byte]));
        response.end();
      },
      async (requests) => {
        expect(await sendChat(history)).toBe('\u0111\u00e3 nh\u1eadn');
        expect(requests).toEqual([
          {
            method: 'POST',
            path: '/chat',
            body: JSON.stringify({
              messages: [{ role: 'user', text: 'hello' }],
            }),
          },
        ]);
      },
    );
  });

  it.each(['headers', 'body'] as const)(
    'times out stalled %s over a real socket, without retry',
    async (part) => {
      let closed!: Promise<unknown>;
      await withServer(
        (response) => {
          closed = once(response, 'close');
          if (part === 'body') {
            response.setHeader('content-type', 'application/json');
            response.write('{"text":"');
          }
        },
        async (requests) => {
          const started = Date.now();
          await expect(sendChat(history)).rejects.toMatchObject({
            kind: 'timeout',
            message: 'timeout',
          });
          expect(Date.now() - started).toBeGreaterThanOrEqual(
            CHAT_TIMEOUT_MS - 100,
          );
          await expectClosed(closed);
          expect(requests).toHaveLength(1);
        },
      );
    },
    CHAT_TIMEOUT_MS + 5000,
  );

  it('cancels an in-flight request, closes the connection and permits an explicit next attempt', async () => {
    const controller = new AbortController();
    let count = 0;
    let closed!: Promise<unknown>;
    await withServer(
      (response) => {
        if (++count === 1) {
          closed = once(response, 'close');
          response.write('{"text":"unfinished');
          controller.abort();
        } else response.end(JSON.stringify({ text: 'second attempt' }));
      },
      async (requests) => {
        await expect(
          sendChat(history, { signal: controller.signal }),
        ).rejects.toMatchObject({ kind: 'cancelled' });
        await expectClosed(closed);
        expect(requests).toHaveLength(1);
        expect(await sendChat(history)).toBe('second attempt');
        expect(requests).toHaveLength(2);
      },
    );
  });

  it.each([
    { code: 500, body: 'PRIVATE_REMOTE_ERROR', kind: 'http' },
    { code: 200, body: '{"text":', kind: 'invalid' },
    { code: 200, body: '{"text":"   "}', kind: 'invalid' },
  ])(
    'sanitizes $code/$kind responses without retry',
    async ({ code, body, kind }) => {
      await withServer(
        (response) => {
          response.writeHead(code, { 'content-type': 'application/json' });
          response.end(body);
        },
        async (requests) => {
          await expect(sendChat(history)).rejects.toMatchObject({
            kind,
            message: kind,
          });
          expect(requests).toHaveLength(1);
        },
      );
    },
  );

  it('handles a connection reset without retrying the prompt', async () => {
    await withServer(
      (response) => response.destroy(),
      async (requests) => {
        await expect(sendChat(history)).rejects.toMatchObject({
          kind: 'network',
          message: 'network',
        });
        expect(requests).toHaveLength(1);
      },
    );
  });
});
