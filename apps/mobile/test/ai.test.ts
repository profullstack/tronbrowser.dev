import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_TIMEOUT_MS, sendChat } from '../src/lib/ai';
const history = [{ id: 'u-1', role: 'user' as const, text: 'hello' }];
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('one bounded chat attempt', () => {
  it('posts only conversation fields and returns valid text', async () => {
    vi.stubEnv('EXPO_PUBLIC_AI_ENDPOINT', 'https://ai.example/');
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ text: 'reply' })),
    );
    vi.stubGlobal('fetch', fetcher);
    expect(await sendChat(history)).toBe('reply');
    expect(fetcher).toHaveBeenCalledWith(
      'https://ai.example/chat',
      expect.objectContaining({
        body: JSON.stringify({ messages: [{ role: 'user', text: 'hello' }] }),
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each(['headers', 'body'])(
    'enforces a deadline through stalled %s',
    async (part) => {
      vi.useFakeTimers();
      vi.stubEnv('EXPO_PUBLIC_AI_ENDPOINT', 'https://ai.example');
      const fetcher = vi.fn(() =>
        part === 'headers'
          ? new Promise<Response>(() => {})
          : Promise.resolve({
              ok: true,
              json: () => new Promise(() => {}),
            } as Response),
      );
      vi.stubGlobal('fetch', fetcher);
      const result = expect(sendChat(history)).rejects.toMatchObject({
        kind: 'timeout',
      });
      await vi.advanceTimersByTimeAsync(CHAT_TIMEOUT_MS);
      await result;
      expect(vi.getTimerCount()).toBe(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each([null, {}, [], { text: 3 }, { text: '   ' }, 'string'])(
    'rejects malformed response %j',
    async (value) => {
      vi.stubEnv('EXPO_PUBLIC_AI_ENDPOINT', 'https://ai.example');
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify(value))),
      );
      await expect(sendChat(history)).rejects.toMatchObject({
        kind: 'invalid',
      });
    },
  );
  it('never displays remote errors or retries automatically', async () => {
    vi.stubEnv('EXPO_PUBLIC_AI_ENDPOINT', 'https://ai.example');
    const fetcher = vi.fn(async () => new Response('SECRET', { status: 500 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(sendChat(history)).rejects.toMatchObject({ message: 'http' });
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockRejectedValue(new Error('SECRET'));
    await expect(sendChat(history)).rejects.toMatchObject({
      message: 'network',
    });
  });
  it('cancels before and during fetch even if transport ignores abort', async () => {
    vi.useFakeTimers();
    vi.stubEnv('EXPO_PUBLIC_AI_ENDPOINT', 'https://ai.example');
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetcher);
    const stopped = new AbortController();
    stopped.abort();
    await expect(
      sendChat(history, { signal: stopped.signal }),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    expect(fetcher).not.toHaveBeenCalled();
    const active = new AbortController();
    const result = expect(
      sendChat(history, { signal: active.signal }),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    active.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps the offline stub honest and cancels its delay without timers', async () => {
    vi.useFakeTimers();
    vi.stubEnv('EXPO_PUBLIC_AI_ENDPOINT', '');
    const result = sendChat(history);
    await vi.advanceTimersByTimeAsync(350);
    expect(await result).toContain('Offline stub');
    expect(vi.getTimerCount()).toBe(0);
    const controller = new AbortController();
    const cancelled = expect(
      sendChat(history, { signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    controller.abort();
    await cancelled;
    expect(vi.getTimerCount()).toBe(0);
  });
});
