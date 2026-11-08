import { describe, expect, it } from 'vitest';
import type { CdpConnection } from './cdp-client.js';
import { goto, NavigationError, PAGE_LOAD_TIMEOUT_MS, PageLoadTimeoutError } from './page.js';

/** A fake page: `navigate` is what Page.navigate answers; `load` fires loadEventFired after it. */
function fakeConn(navigate: Record<string, unknown>, load: boolean) {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const conn: CdpConnection = {
    send: (async (method: string) => {
      if (method === 'Page.navigate' && load) queueMicrotask(() => handlers.get('Page.loadEventFired')?.forEach((h) => h({})));
      return method === 'Page.navigate' ? navigate : {};
    }) as CdpConnection['send'],
    on: (m, h) => {
      if (!handlers.has(m)) handlers.set(m, new Set());
      handlers.get(m)!.add(h);
    },
    off: (m, h) => {
      handlers.get(m)?.delete(h);
    },
    close: () => {},
  };
  return { conn, listeners: () => handlers.get('Page.loadEventFired')?.size ?? 0 };
}

describe('goto', () => {
  it('has a 30 s default budget', () => {
    expect(PAGE_LOAD_TIMEOUT_MS).toBe(30_000);
  });

  it('resolves on load and drops its listener', async () => {
    const f = fakeConn({ frameId: 'f', loaderId: 'l' }, true);
    await goto(f.conn, 'https://example.com/');
    expect(f.listeners()).toBe(0);
  });

  it('REJECTS when load never fires (it used to resolve silently)', async () => {
    const f = fakeConn({ frameId: 'f', loaderId: 'l' }, false);
    const err = await goto(f.conn, 'https://slow.example/', { timeoutMs: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(PageLoadTimeoutError);
    expect(err.code).toBe('PAGE_LOAD_TIMEOUT');
    expect(err.timeoutMs).toBe(20);
    expect(f.listeners()).toBe(0);
  });

  it('rejects with the net::ERR text when Chromium cannot load the document', async () => {
    const f = fakeConn({ frameId: 'f', loaderId: 'l', errorText: 'net::ERR_NAME_NOT_RESOLVED' }, false);
    const err = await goto(f.conn, 'https://nope.invalid/').catch((e) => e);
    expect(err).toBeInstanceOf(NavigationError);
    expect(err.errorText).toBe('net::ERR_NAME_NOT_RESOLVED');
  });

  it('a same-document navigation (no loader) resolves without waiting for load', async () => {
    const f = fakeConn({ frameId: 'f' }, false);
    await goto(f.conn, 'https://example.com/#x', { timeoutMs: 5_000 });
  });
});
