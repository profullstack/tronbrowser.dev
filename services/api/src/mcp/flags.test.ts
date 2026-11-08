import { describe, expect, it } from 'vitest';
import {
  CRAWL_FLAG_DAYS,
  CRAWL_FLAG_MS,
  classifyFailure,
  FLAGGED_PREFIX,
  FlaggedTargetError,
  flagTargets,
  memoryFlagStore,
  RECHECK_LEASE_MS,
  withFlags,
} from './flags.js';

const timeout = Object.assign(new Error('Page load timed out after 30000ms: https://slow.example/a'), { code: 'PAGE_LOAD_TIMEOUT' });
const dns = Object.assign(new Error('Navigation failed (net::ERR_NAME_NOT_RESOLVED): https://dead.example/'), { errorText: 'net::ERR_NAME_NOT_RESOLVED' });
const http503 = Object.assign(new Error('HTTP 503 from https://x.example/'), { code: 'HTTP_STATUS', status: 503 });

describe('crawl flags', () => {
  it('flags for 30 days', () => {
    expect(CRAWL_FLAG_DAYS).toBe(30);
    expect(CRAWL_FLAG_MS).toBe(30 * 86_400_000);
  });

  it('keys a URL by url (fragment dropped) and by host', () => {
    expect(flagTargets('https://Ex.COM/a?b=1#frag')).toEqual({ url: 'url:https://ex.com/a?b=1', host: 'host:ex.com' });
  });

  it('classifies target failures and ignores ours', () => {
    expect(classifyFailure(timeout, 'https://slow.example/a')).toMatchObject({ scope: 'url', reason: 'timeout', target: 'url:https://slow.example/a' });
    expect(classifyFailure(dns, 'https://dead.example/x')).toMatchObject({ scope: 'host', reason: 'connection', target: 'host:dead.example' });
    expect(classifyFailure(new Error('Navigation failed (net::ERR_CERT_DATE_INVALID): u'), 'https://t.example/')).toMatchObject({ scope: 'host' });
    expect(classifyFailure(new Error('Navigation failed (net::ERR_CONNECTION_REFUSED): u'), 'https://t.example/')).toMatchObject({ scope: 'host' });
    expect(classifyFailure(http503, 'https://x.example/')).toMatchObject({ scope: 'url', reason: 'http_5xx' });
    expect(classifyFailure(Object.assign(new Error('HTTP 404'), { code: 'HTTP_STATUS', status: 404 }), 'https://x.example/')).toBeNull();
    expect(classifyFailure(new Error('Busy: 3 pages are rendering. Try again in a moment.'), 'https://x.example/')).toBeNull();
    expect(classifyFailure(new Error('No Chromium found (set TRON_CHROMIUM_BIN or install ungoogled-chromium).'), 'https://x.example/')).toBeNull();
    expect(classifyFailure(new Error('Error: Network error: Network error: Access to private/internal IP address 10.0.0.1 is not allowed'), 'https://x.example/')).toBeNull();
    expect(classifyFailure(new Error('Error: Network error: Network error: https://x.example/: error sending request'), 'https://x.example/')).toMatchObject({ reason: 'network' });
  });

  it('a failure flags the target; the next call is skipped fast with the date, without running work', async () => {
    const store = memoryFlagStore();
    let now = Date.parse('2026-11-08T00:00:00Z');
    const clock = { now: () => now };
    await expect(withFlags(store, 'https://slow.example/a', async () => { throw timeout; }, clock)).rejects.toBe(timeout);
    let ran = false;
    const err = await withFlags(store, 'https://slow.example/a', async () => { ran = true; }, clock).catch((e) => e);
    expect(ran).toBe(false);
    expect(err).toBeInstanceOf(FlaggedTargetError);
    expect(err.message.startsWith(`${FLAGGED_PREFIX} 2026-12-08T00:00:00.000Z`)).toBe(true);
    // another page on the same host is not affected by a URL-level flag
    await expect(withFlags(store, 'https://slow.example/b', async () => 'ok', clock)).resolves.toBe('ok');
    now += 29 * 86_400_000;
    await expect(withFlags(store, 'https://slow.example/a', async () => 'ok', clock)).rejects.toBeInstanceOf(FlaggedTargetError);
  });

  it('a host-level failure skips every page on that host', async () => {
    const store = memoryFlagStore();
    const clock = { now: () => 1_000 };
    await expect(withFlags(store, 'https://dead.example/', async () => { throw dns; }, clock)).rejects.toBe(dns);
    await expect(withFlags(store, 'https://dead.example/other', async () => 'x', clock)).rejects.toThrow(/host dead\.example/);
  });

  it('after 30 days: exactly one recheck; success clears, failure re-flags 30 more days', async () => {
    const store = memoryFlagStore();
    let now = 0;
    const clock = { now: () => now };
    await withFlags(store, 'https://x.example/', async () => { throw http503; }, clock).catch(() => {});
    now = CRAWL_FLAG_MS + 1;
    // first caller claims the recheck; a parallel second caller is still skipped
    let release!: () => void;
    const first = withFlags(store, 'https://x.example/', () => new Promise<never>((_, rej) => { release = () => rej(http503); }), clock);
    await new Promise((r) => setTimeout(r, 0));
    const second = await withFlags(store, 'https://x.example/', async () => 'ok', clock).catch((e) => e);
    expect(second).toBeInstanceOf(FlaggedTargetError);
    expect(Date.parse(second.flag.nextCheckAt)).toBe(now + RECHECK_LEASE_MS);
    release();
    await expect(first).rejects.toBe(http503);
    const [f] = await store.get(['url:https://x.example/']);
    expect(f!.failCount).toBe(2);
    expect(Date.parse(f!.nextCheckAt)).toBe(now + CRAWL_FLAG_MS);
    now += CRAWL_FLAG_MS + 1;
    await expect(withFlags(store, 'https://x.example/', async () => 'back', clock)).resolves.toBe('back');
    expect(await store.get(['url:https://x.example/'])).toEqual([]);
  });

  it('a broken store never blocks a fetch', async () => {
    const broken = { get: async () => { throw new Error('db down'); }, claim: async () => true, flag: async () => { throw new Error('db down'); }, clear: async () => {} };
    await expect(withFlags(broken, 'https://x.example/', async () => 'ok')).resolves.toBe('ok');
    await expect(withFlags(broken, 'https://x.example/', async () => { throw timeout; })).rejects.toBe(timeout);
  });

  it('the memory store stays bounded', async () => {
    const store = memoryFlagStore(3);
    for (let i = 0; i < 10; i++) await store.flag({ target: `url:${i}`, scope: 'url', reason: 'timeout', lastError: '' }, 0);
    expect(store.size()).toBe(3);
  });
});
