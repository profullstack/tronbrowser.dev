import { afterEach, expect, it, vi } from 'vitest';
import { CHAT_TIMEOUT_MS, sendChat } from '../src/lib/ai';

const LIMIT = 65536;
const history = [{ id: '1', role: 'user' as const, text: 'hello' }];
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup(response: Response) {
  vi.stubEnv('EXPO_PUBLIC_AI_ENDPOINT', 'https://ai.example');
  const fetcher = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

it.each([-1, 0, 1])('request UTF-8 boundary %+d', async delta => {
  const fetcher = setup(new Response('{"text":"ok"}'));
  const overhead = JSON.stringify({ messages: [{ role: 'user', text: '' }] }).length;
  const text = '\u0111' + 'x'.repeat(LIMIT + delta - overhead - 2);
  const input = [{ ...history[0]!, text }];
  if (delta > 0) {
    await expect(sendChat(input)).rejects.toMatchObject({ kind: 'request_too_large' });
    expect(fetcher).not.toHaveBeenCalled();
  } else expect(await sendChat(input)).toBe('ok');
  expect(input[0]!.text).toBe(text);
});
it.each([-1, 0, 1])('stream response UTF-8 boundary %+d', async delta => {
  const text = '\u0111' + 'x'.repeat(LIMIT + delta - 13);
  setup(new Response(JSON.stringify({ text })));
  if (delta > 0) await expect(sendChat(history)).rejects.toMatchObject({ kind: 'response_too_large' });
  else expect(await sendChat(history)).toBe(text);
});
it.each([-1, 0, 1])('RN-like buffered response boundary %+d', async delta => {
  const text = 'x'.repeat(LIMIT + delta - 11);
  setup({ ok: true, headers: new Headers(), body: null, text: async () => JSON.stringify({ text }) } as Response);
  if (delta > 0) await expect(sendChat(history)).rejects.toMatchObject({ kind: 'response_too_large' });
  else expect(await sendChat(history)).toBe(text);
});
it.each([undefined, '1', '999999'])('cancels oversize streams with content-length %s', async length => {
  const cancel = vi.fn();
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(LIMIT + 1)); }, cancel });
  const response = new Response(stream, { headers: length ? { 'content-length': length } : {} });
  setup(response);
  await expect(sendChat(history)).rejects.toMatchObject({ kind: 'response_too_large' });
  expect(cancel).toHaveBeenCalledOnce();
});
it('cancels a late response from a transport which ignored abort', async () => {
  vi.stubEnv('EXPO_PUBLIC_AI_ENDPOINT', 'https://ai.example');
  let resolve!: (r: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r; })));
  const controller = new AbortController();
  const result = expect(sendChat(history, { signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' });
  controller.abort();
  await result;
  const cancel = vi.fn();
  resolve(new Response(new ReadableStream({ cancel })));
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
});

it('rejects oversized offline history before scheduling a reply', async () => {
  vi.useFakeTimers();
  vi.stubEnv('EXPO_PUBLIC_AI_ENDPOINT', '');
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(sendChat([{ ...history[0]!, text: 'x'.repeat(LIMIT) }]))
    .rejects.toMatchObject({ kind: 'request_too_large' });
  expect(fetcher).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('rejects an oversized declared length without reading even a small body', async () => {
  const cancel = vi.fn();
  setup(new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('{"text":"ok"}')); },
    cancel,
  }), { headers: { 'content-length': String(LIMIT + 1) } }));
  await expect(sendChat(history)).rejects.toMatchObject({ kind: 'response_too_large' });
  expect(cancel).toHaveBeenCalledOnce();
});

it.each(['size-first', 'cancel-first', 'timeout-first'])('preserves the first terminal event: %s', async order => {
  vi.useFakeTimers();
  const external = new AbortController();
  let body!: ReadableStreamDefaultController<Uint8Array>;
  let cancelReason: unknown;
  const cancel = vi.fn(() => {
    // An external cancellation during size-triggered transport cleanup must not replace it.
    cancelReason = 'cancelled';
    external.abort();
  });
  setup(new Response(new ReadableStream({ start(c) { body = c; }, cancel })));
  const result = sendChat(history, { signal: external.signal });
  const expected = order === 'size-first' ? 'response_too_large' : order === 'timeout-first' ? 'timeout' : 'cancelled';
  const assertion = expect(result).rejects.toMatchObject({ kind: expected });
  await Promise.resolve();
  if (order === 'size-first') body.enqueue(new Uint8Array(LIMIT + 1));
  else if (order === 'cancel-first') external.abort();
  else await vi.advanceTimersByTimeAsync(CHAT_TIMEOUT_MS);
  await assertion;
  expect(cancel).toHaveBeenCalledOnce();
  expect(cancelReason).toBe('cancelled');
  expect(vi.getTimerCount()).toBe(0);
});
