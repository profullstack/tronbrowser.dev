import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, storageGet, withTimeout } from './net.js';

afterEach(() => {
  vi.unstubAllGlobals();
  delete globalThis.chrome;
});

// A promise that never settles — the failure this module exists to bound.
const forever = () => new Promise(() => {});

describe('fetchWithTimeout', () => {
  it('returns the response when the host answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    await expect(fetchWithTimeout('https://example.test')).resolves.toMatchObject({ ok: true });
  });

  it('rejects instead of hanging when the host never answers', async () => {
    // The host accepted the connection and went quiet: without the abort this
    // promise is pending for the life of the tab and its section never renders.
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })));
    await expect(fetchWithTimeout('https://example.test', {}, 20)).rejects.toThrow('timed out');
  });

  it('passes the caller options through and adds a signal', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', spy);
    await fetchWithTimeout('https://example.test', { method: 'POST', headers: { a: 'b' } });
    const [, opts] = spy.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual({ a: 'b' });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces a real network error unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ERR_NAME_NOT_RESOLVED')));
    await expect(fetchWithTimeout('https://example.test')).rejects.toThrow('ERR_NAME_NOT_RESOLVED');
  });
});

describe('withTimeout', () => {
  it('passes the value through when it arrives in time', async () => {
    await expect(withTimeout(Promise.resolve('v'), 50, 'fallback')).resolves.toBe('v');
  });

  it('falls back when the promise stalls', async () => {
    await expect(withTimeout(forever(), 10, 'fallback')).resolves.toBe('fallback');
  });

  it('falls back when the promise rejects', async () => {
    await expect(withTimeout(Promise.reject(new Error('nope')), 50, 'fallback')).resolves.toBe('fallback');
  });
});

describe('storageGet', () => {
  it('returns what storage holds', async () => {
    globalThis.chrome = { storage: { local: { get: vi.fn().mockResolvedValue({ aiConfig: { model: 'm' } }) } } };
    await expect(storageGet('aiConfig')).resolves.toEqual({ aiConfig: { model: 'm' } });
  });

  it('returns {} rather than hanging when the profile database stalls', async () => {
    // Callers all read this as "nothing stored" and render their default state,
    // which is the point: a stalled read must not decide whether the UI appears.
    globalThis.chrome = { storage: { local: { get: vi.fn().mockImplementation(forever) } } };
    await expect(storageGet('aiConfig')).resolves.toEqual({});
  }, 10000);
});
