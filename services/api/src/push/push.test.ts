import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createClient as createSqliteClient, type Client } from '@libsql/client';
import { createClient as createPgClient } from '@profullstack/libsql-pg';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { generateVapidKeys, sendPush, vapidHeader } from '@profullstack/notifications/server';
import { pushService } from './routes.js';
import { verifyVapid } from './vapid.js';
// The extension's own decryptor: the test proves a real sender's push reaches
// the browser end readable, not just that the server returned 201.
import {
  createSubscriptionKeys,
  decryptPush,
  fromB64u,
  notificationFromPayload,
} from '../../../../apps/desktop/extensions/ai-sidebar/push-crypto.js';

const BASE = 'https://tronbrowser.dev/api/1/push';
// The suite runs against an in-memory SQLite by default, so CI needs no
// database. With TEST_DATABASE_URL=postgres://... it runs the same requests
// through @profullstack/libsql-pg against the Postgres schema instead, which is
// what production uses.
const PG_URL = process.env.TEST_DATABASE_URL;
const migration = readFileSync(
  new URL(`../../../../packages/storage/${PG_URL ? 'migrations-pg' : 'migrations'}/0007_push.sql`, import.meta.url),
  'utf8',
);
const PUSH_TABLES = ['push_messages', 'push_subscriptions', 'push_devices'];

async function freshClient(): Promise<Client> {
  if (!PG_URL) {
    const c = createSqliteClient({ url: ':memory:' });
    await c.executeMultiple(migration);
    return c;
  }
  // Postgres: the pg pool runs the whole file in one round trip, then the
  // tables are emptied so each test starts blank.
  const c = createPgClient({ url: PG_URL, dialect: 'postgres' }) as unknown as Client & { pool: { query: (sql: string) => Promise<unknown> } };
  await c.pool.query(migration);
  await c.pool.query(`TRUNCATE ${PUSH_TABLES.join(', ')}`);
  // The routes speak SQLite; a second client with the default dialect rewrites them.
  return createPgClient({ url: PG_URL }) as unknown as Client;
}

let client: Client;
let app: Hono;
let service: ReturnType<typeof pushService>;
const secret = randomBytes(32).toString('base64url');
const auth = { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };

beforeEach(async () => {
  client = await freshClient();
  service = pushService({ db: () => client, publicBase: BASE });
  app = new Hono();
  app.route('/api/1/push', service.app);
});

const fetchVia = (url: string | URL | Request, init?: RequestInit) => app.request(String(url), init);

async function subscribe(applicationServerKey: string | null) {
  const res = await app.request(`${BASE}/subscriptions`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ origin: 'https://agenticjobs.work', applicationServerKey }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { token: string; endpoint: string };
}

describe('tronbrowser push service', () => {
  it('relays a real Web Push end to end, and only the browser can read it', async () => {
    const vapid = generateVapidKeys();
    const keys = await createSubscriptionKeys();
    const { endpoint } = await subscribe(vapid.publicKey);
    expect(endpoint.startsWith(`${BASE}/`)).toBe(true);

    const payload = JSON.stringify({ title: 'New match', body: 'rust / remote', url: '/jobs/x' });
    const result = await sendPush(
      { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
      payload,
      { keys: vapid, subject: 'mailto:ops@agenticjobs.work', fetch: fetchVia as any },
    );
    expect(result.error).toBeNull();
    expect(result.sent).toBe(true);
    expect(result.status).toBe(201);

    const pending = await (await app.request(`${BASE}/messages`, { headers: auth })).json();
    expect(pending.messages).toHaveLength(1);
    const [message] = pending.messages;
    expect(message.origin).toBe('https://agenticjobs.work');
    expect(message.encoding).toBe('aes128gcm');
    // The stored body is ciphertext, not the payload.
    expect(Buffer.from(message.body, 'base64url').toString()).not.toContain('New match');

    const plain = new TextDecoder().decode(await decryptPush(fromB64u(message.body), keys));
    expect(plain).toBe(payload);
    expect(notificationFromPayload(plain, message.origin)).toMatchObject({
      title: 'New match', body: 'rust / remote', url: 'https://agenticjobs.work/jobs/x',
    });

    const acked = await app.request(`${BASE}/ack`, { method: 'POST', headers: auth, body: JSON.stringify({ ids: [message.id] }) });
    expect((await acked.json()).acked).toBe(1);
    expect((await (await app.request(`${BASE}/messages`, { headers: auth })).json()).messages).toHaveLength(0);
  });

  it('refuses a sender whose VAPID key is not the one the site subscribed with', async () => {
    const { endpoint } = await subscribe(generateVapidKeys().publicKey);
    const keys = await createSubscriptionKeys();
    const result = await sendPush(
      { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
      'hi',
      { keys: generateVapidKeys(), subject: 'mailto:x@example.com', fetch: fetchVia as any },
    );
    expect(result.status).toBe(403);
  });

  it('answers 404 for an unknown endpoint and 410 once unsubscribed, so senders clean up', async () => {
    expect((await app.request(`${BASE}/nope`, { method: 'POST', headers: { ttl: '60' } })).status).toBe(404);
    const { token } = await subscribe(null);
    const del = await app.request(`${BASE}/subscriptions/${token}`, { method: 'DELETE', headers: auth });
    expect((await del.json()).deleted).toBe(true);
    expect((await app.request(`${BASE}/${token}`, { method: 'POST', headers: { ttl: '60' } })).status).toBe(410);
  });

  it('enforces the protocol: TTL, encoding, size', async () => {
    const vapid = generateVapidKeys();
    const { token } = await subscribe(vapid.publicKey);
    const authorization = vapidHeader(vapid, 'https://tronbrowser.dev', 'mailto:x@example.com');
    const post = (headers: Record<string, string>, body?: Uint8Array) =>
      app.request(`${BASE}/${token}`, { method: 'POST', headers: { authorization, ...headers }, body });
    expect((await post({})).status).toBe(400);                                              // no TTL
    expect((await post({ ttl: '60', 'content-encoding': 'aesgcm' }, new Uint8Array(10))).status).toBe(415);
    expect((await post({ ttl: '60', 'content-encoding': 'aes128gcm' }, new Uint8Array(5000))).status).toBe(413);
    expect((await post({ ttl: '60' })).status).toBe(201);                                   // empty push is fine
    expect((await app.request(`${BASE}/${token}`, { method: 'POST', headers: { ttl: '60' } })).status).toBe(401); // no VAPID
  });

  it('a newer push with the same Topic replaces the pending one', async () => {
    const { token } = await subscribe(null);
    for (let i = 0; i < 3; i++) {
      await app.request(`${BASE}/${token}`, { method: 'POST', headers: { ttl: '60', topic: 'inbox' } });
    }
    expect((await (await app.request(`${BASE}/messages`, { headers: auth })).json()).messages).toHaveLength(1);
  });

  it('refuses browser calls without a device secret, and a non-https origin', async () => {
    expect((await app.request(`${BASE}/messages`)).status).toBe(401);
    const res = await app.request(`${BASE}/subscriptions`, {
      method: 'POST', headers: auth, body: JSON.stringify({ origin: 'http://evil.example' }),
    });
    expect(res.status).toBe(400);
  });

  it('describes itself, so a settings page can check a custom push service', async () => {
    const res = await app.request(BASE);
    expect(await res.json()).toMatchObject({ service: 'tronbrowser-push', version: 1 });
  });
});

describe('verifyVapid', () => {
  it('rejects an audience for another push service', () => {
    const vapid = generateVapidKeys();
    const header = vapidHeader(vapid, 'https://fcm.googleapis.com', 'mailto:x@example.com');
    const r = verifyVapid({ authorization: header }, 'https://tronbrowser.dev', vapid.publicKey);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });
});
