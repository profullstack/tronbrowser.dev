import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { generateVapidKeys, sendPush } from '@profullstack/notifications/server';
import { pushService } from './routes.ts';
import { DEFAULT_PUSH_SERVICE, poll, pushServiceFrom, subscribe, unsubscribe, getSubscription } from '../../../../apps/desktop/extensions/ai-sidebar/push-client.js';

const migration = readFileSync(new URL('../../../../packages/storage/migrations/0007_push.sql', import.meta.url), 'utf8');

function fakeChrome() {
  const local = {};
  const session = {};
  const area = (store) => ({
    async get(keys) {
      const list = typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
    },
    async set(obj) { Object.assign(store, structuredClone(obj)); },
    async remove(k) { delete store[k]; },
  });
  return {
    local,
    session,
    notifications: { create: vi.fn(async () => 'id') },
    storage: { local: area(local), session: area(session) },
    runtime: { getURL: (p) => `chrome-extension://tron/${p}` },
  };
}

let app;
beforeEach(async () => {
  const client = createClient({ url: ':memory:' });
  await client.executeMultiple(migration);
  const service = pushService({ db: () => client, publicBase: DEFAULT_PUSH_SERVICE });
  app = new Hono();
  app.route('/api/1/push', service.app);
  globalThis.chrome = fakeChrome();
  vi.stubGlobal('fetch', (url, init) => app.request(String(url), init));
  vi.stubGlobal('WebSocket', class { constructor() { throw new Error('no sockets in tests'); } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete globalThis.chrome;
});

describe('pushServiceFrom', () => {
  it('defaults to ours, honours off and an https URL, ignores junk', () => {
    expect(pushServiceFrom(undefined)).toBe('https://tronbrowser.dev/api/1/push');
    expect(pushServiceFrom('off')).toBeNull();
    expect(pushServiceFrom('https://push.example.com/api/1/push/')).toBe('https://push.example.com/api/1/push');
    expect(pushServiceFrom('http://evil.example/push')).toBe(DEFAULT_PUSH_SERVICE);
  });
});

describe('push client', () => {
  it('a site subscribes, its server pushes, TronBrowser shows it', async () => {
    const vapid = generateVapidKeys();
    const { subscription } = await subscribe('https://agenticjobs.work', undefined, vapid.publicKey);
    expect(subscription.endpoint.startsWith(`${DEFAULT_PUSH_SERVICE}/`)).toBe(true);
    // Asking again returns the same subscription, as the native API does.
    expect((await getSubscription('https://agenticjobs.work')).subscription.endpoint).toBe(subscription.endpoint);

    const sent = await sendPush(subscription, JSON.stringify({ title: 'New match', body: 'rust / remote', url: '/jobs/x' }), {
      keys: vapid, subject: 'mailto:ops@agenticjobs.work', fetch: (u, i) => app.request(String(u), i),
    });
    expect(sent.sent).toBe(true);

    await poll();
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [id, shown] = chrome.notifications.create.mock.calls[0];
    expect(shown).toMatchObject({ title: 'New match', message: 'rust / remote', contextMessage: 'agenticjobs.work' });
    expect(chrome.session[id]).toBe('https://agenticjobs.work/jobs/x');

    // Acked: a second poll shows nothing new.
    await poll();
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
  });

  it('a different applicationServerKey on an existing subscription is refused, like the native API', async () => {
    await subscribe('https://a.example', undefined, generateVapidKeys().publicKey);
    const again = await subscribe('https://a.example', undefined, generateVapidKeys().publicKey);
    expect(again.error).toBe('InvalidStateError');
  });

  it('unsubscribing tells the service, so the sender learns it is gone', async () => {
    const vapid = generateVapidKeys();
    const { subscription } = await subscribe('https://a.example', undefined, vapid.publicKey);
    await unsubscribe('https://a.example');
    const sent = await sendPush(subscription, 'hi', { keys: vapid, subject: 'mailto:x@example.com', fetch: (u, i) => app.request(String(u), i) });
    expect(sent.gone).toBe(true);
  });

  it('with push off, the page falls through to the engine', async () => {
    chrome.local.pushService = 'off';
    expect(await subscribe('https://a.example', undefined, null)).toEqual({ off: true });
  });
});
