import { describe, it, expect, vi } from 'vitest';
import { createProvider } from './index.js';
import { sseLines } from './adapter-openai.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

/** Builds a Response whose body streams the given SSE chunks. */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = {
    getReader() {
      return {
        read: async () => (i < chunks.length
          ? { value: encoder.encode(chunks[i++]), done: false }
          : { value: undefined, done: true }),
      };
    },
  } as unknown as ReadableStream<Uint8Array>;
  return { ok: true, status: 200, body } as Response;
}

describe('OpenAI-compatible adapter', () => {
  it('completes via /chat/completions', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: 'hi there' } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      }),
    ) as unknown as typeof fetch;

    const provider = createProvider('deepseek', { apiKey: 'k', fetchImpl });
    const res = await provider.complete({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.text).toBe('hi there');
    expect(res.usage).toEqual({ promptTokens: 3, completionTokens: 2 });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer k' });
  });

  it('streams deltas from SSE', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
        'data: [DONE]\n',
      ]),
    ) as unknown as typeof fetch;

    const provider = createProvider('openai', { apiKey: 'k', fetchImpl });
    const out: string[] = [];
    for await (const c of provider.stream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
      if (c.delta) out.push(c.delta);
    }
    expect(out.join('')).toBe('Hello');
  });

  it('throws on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, false, 401)) as unknown as typeof fetch;
    const provider = createProvider('openai', { apiKey: 'bad', fetchImpl });
    await expect(provider.complete({ model: 'gpt-4o', messages: [] })).rejects.toThrow(/401/);
  });
});

describe('Anthropic adapter', () => {
  it('lifts the system prompt out of messages', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        content: [{ type: 'text', text: 'pong' }],
        usage: { input_tokens: 5, output_tokens: 1 },
      }),
    ) as unknown as typeof fetch;

    const provider = createProvider('anthropic', { apiKey: 'sk-ant', fetchImpl });
    const res = await provider.complete({
      model: 'claude-opus-4-8',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'ping' },
      ],
    });
    expect(res.text).toBe('pong');

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.system).toBe('be terse');
    expect(sent.messages).toEqual([{ role: 'user', content: 'ping' }]);
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'sk-ant' });
  });
});

describe('sseLines', () => {
  it('extracts data payloads across chunk boundaries', async () => {
    const encoder = new TextEncoder();
    let i = 0;
    const parts = ['data: a\nda', 'ta: b\n'];
    const body = {
      getReader: () => ({
        read: async () => (i < parts.length
          ? { value: encoder.encode(parts[i++]), done: false }
          : { value: undefined, done: true }),
      }),
    } as unknown as ReadableStream<Uint8Array>;
    const got: string[] = [];
    for await (const d of sseLines(body)) got.push(d);
    expect(got).toEqual(['a', 'b']);
  });
});
