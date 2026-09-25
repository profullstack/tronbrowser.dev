// TronBrowser's own Web Push service, mounted at /api/1/push.
//
// Why it exists: ungoogled-chromium ships without Google's push service, and a
// page cannot choose another one, so pushManager.subscribe() fails for every
// site ("Registration failed - push service error"). The bundled extension
// replaces pushManager and registers here instead. The browser's push service
// is a TronBrowser setting; this is the default.
//
// Two sides:
//   senders   POST /api/1/push/:token        RFC 8030 + 8291 + 8292, exactly what
//                                            web-push / @profullstack/notifications send
//   browsers  POST   /api/1/push/subscriptions        (Bearer <device secret>)
//             DELETE /api/1/push/subscriptions/:token
//             GET    /api/1/push/messages             pending pushes
//             POST   /api/1/push/ack                  { ids }
//             GET    /api/1/push/connect              WebSocket: live delivery
//
// We never see a payload in the clear: it arrives encrypted to a key only the
// browser holds, and is relayed as-is.
import { Hono } from 'hono';
import type { Client } from '@profullstack/libsql-pg';
import { createHash, randomBytes } from 'node:crypto';
import { verifyVapid } from './vapid.js';

export const MAX_PAYLOAD = 4096;          // RFC 8291 records; what every push service accepts
export const MAX_TTL = 28 * 24 * 3600;    // FCM's ceiling
const MAX_SUBSCRIPTIONS_PER_DEVICE = 500;
const SENDS_PER_MINUTE = 120;             // per subscription

export interface PushMessage {
  id: string;
  token: string;
  origin: string;
  body: string;
  encoding: string | null;
}

type Socket = { send(data: string): void; close(): void };

export interface PushServiceOptions {
  db: () => Client;
  /** Public base of this service, e.g. https://tronbrowser.dev/api/1/push */
  publicBase: string;
  upgradeWebSocket?: (handler: (c: any) => any) => any;
  now?: () => number;
}

const id = () => randomBytes(16).toString('base64url');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** A device secret is 32+ random bytes, base64url; its sha256 is the device id. */
function deviceIdFrom(secret: string | undefined): string | null {
  if (!secret || !/^[A-Za-z0-9_-]{43,128}$/.test(secret)) return null;
  return sha256(secret);
}

function bearer(c: any): string | undefined {
  return c.req.header('authorization')?.replace(/^Bearer\s+/i, '') || undefined;
}

/** https origins only (plus http://localhost for development). */
export function normalOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return u.origin;
  } catch { /* not a URL */ }
  return null;
}

/** An applicationServerKey as base64url, or null when it is not a P-256 point. */
export function normalAppKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = Buffer.from(value, 'base64url');
  return raw.length === 65 && raw[0] === 4 ? raw.toString('base64url') : null;
}

export function pushService(opts: PushServiceOptions) {
  const db = opts.db;
  const now = opts.now ?? Date.now;
  const base = opts.publicBase.replace(/\/$/, '');
  const audience = new URL(base).origin;
  const sockets = new Map<string, Set<Socket>>();
  const sendCounts = new Map<string, { minute: number; count: number }>();
  const app = new Hono();

  async function touchDevice(deviceId: string) {
    await db().execute({
      sql: `INSERT INTO push_devices (id) VALUES (?)
            ON CONFLICT(id) DO UPDATE SET last_seen_at = datetime('now')`,
      args: [deviceId],
    });
  }

  async function pending(deviceId: string): Promise<PushMessage[]> {
    const r = await db().execute({
      sql: `SELECT m.id, m.token, s.origin, m.body, m.encoding FROM push_messages m
            JOIN push_subscriptions s ON s.token = m.token
            WHERE m.device_id = ? AND m.expires_at > ? AND s.deleted_at IS NULL
            ORDER BY m.created_at LIMIT 100`,
      args: [deviceId, Math.floor(now() / 1000)],
    });
    return r.rows.map((row: any) => ({
      id: row.id, token: row.token, origin: row.origin, body: row.body, encoding: row.encoding ?? null,
    }));
  }

  async function ack(deviceId: string, ids: unknown) {
    const list = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string').slice(0, 200) : [];
    for (const messageId of list) {
      await db().execute({ sql: 'DELETE FROM push_messages WHERE id = ? AND device_id = ?', args: [messageId, deviceId] });
    }
    return list.length;
  }

  function deliver(deviceId: string, message: PushMessage) {
    const open = sockets.get(deviceId);
    if (!open) return;
    const frame = JSON.stringify({ type: 'messages', messages: [message] });
    for (const socket of open) {
      try { socket.send(frame); } catch { /* the close handler tidies up */ }
    }
  }

  function overLimit(token: string): boolean {
    const minute = Math.floor(now() / 60_000);
    const seen = sendCounts.get(token);
    if (!seen || seen.minute !== minute) {
      if (sendCounts.size > 50_000) sendCounts.clear();
      sendCounts.set(token, { minute, count: 1 });
      return false;
    }
    seen.count += 1;
    return seen.count > SENDS_PER_MINUTE;
  }

  /* ---------- what this is, so a settings page can check a custom URL ---------- */
  app.get('/', (c) =>
    c.json({
      service: 'tronbrowser-push',
      version: 1,
      endpoint: `${base}/{token}`,
      maxPayload: MAX_PAYLOAD,
      maxTtl: MAX_TTL,
      docs: 'https://tronbrowser.dev/push',
    }),
  );

  /* ---------- browser side ---------- */
  app.post('/subscriptions', async (c) => {
    const deviceId = deviceIdFrom(bearer(c));
    if (!deviceId) return c.json({ error: 'device secret required' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const origin = normalOrigin(body.origin);
    if (!origin) return c.json({ error: 'origin must be an https origin' }, 400);
    const appKey = body.applicationServerKey == null ? null : normalAppKey(body.applicationServerKey);
    if (body.applicationServerKey != null && !appKey) {
      return c.json({ error: 'applicationServerKey must be a P-256 public key' }, 400);
    }
    await touchDevice(deviceId);
    const count = await db().execute({
      sql: 'SELECT COUNT(*) AS n FROM push_subscriptions WHERE device_id = ? AND deleted_at IS NULL',
      args: [deviceId],
    });
    if (Number((count.rows[0] as any).n) >= MAX_SUBSCRIPTIONS_PER_DEVICE) {
      return c.json({ error: 'too many subscriptions on this device' }, 429);
    }
    const token = randomBytes(32).toString('base64url');
    await db().execute({
      sql: 'INSERT INTO push_subscriptions (token, device_id, origin, app_key) VALUES (?, ?, ?, ?)',
      args: [token, deviceId, origin, appKey],
    });
    return c.json({ token, endpoint: `${base}/${token}` }, 201);
  });

  app.delete('/subscriptions/:token', async (c) => {
    const deviceId = deviceIdFrom(bearer(c));
    if (!deviceId) return c.json({ error: 'device secret required' }, 401);
    const token = c.req.param('token');
    const r = await db().execute({
      sql: `UPDATE push_subscriptions SET deleted_at = datetime('now')
            WHERE token = ? AND device_id = ? AND deleted_at IS NULL`,
      args: [token, deviceId],
    });
    await db().execute({ sql: 'DELETE FROM push_messages WHERE token = ? AND device_id = ?', args: [token, deviceId] });
    return c.json({ deleted: r.rowsAffected > 0 });
  });

  app.get('/messages', async (c) => {
    const deviceId = deviceIdFrom(bearer(c));
    if (!deviceId) return c.json({ error: 'device secret required' }, 401);
    await touchDevice(deviceId);
    return c.json({ messages: await pending(deviceId) });
  });

  app.post('/ack', async (c) => {
    const deviceId = deviceIdFrom(bearer(c));
    if (!deviceId) return c.json({ error: 'device secret required' }, 401);
    const body = await c.req.json().catch(() => ({}));
    return c.json({ acked: await ack(deviceId, body.ids) });
  });

  if (opts.upgradeWebSocket) {
    // Browsers cannot set headers on a WebSocket, so the secret is the first
    // frame: { type: 'hello', secret }. Then pending messages are sent, new ones
    // as they arrive, and the client answers { type: 'ack', ids }.
    app.get(
      '/connect',
      opts.upgradeWebSocket(() => {
        let deviceId: string | null = null;
        let self: Socket | null = null;
        return {
          async onMessage(event: any, ws: Socket) {
            let frame: any;
            try { frame = JSON.parse(String(event.data)); } catch { return; }
            if (frame.type === 'hello' && !deviceId) {
              deviceId = deviceIdFrom(frame.secret);
              if (!deviceId) { ws.send(JSON.stringify({ type: 'error', error: 'device secret required' })); ws.close(); return; }
              self = ws;
              if (!sockets.has(deviceId)) sockets.set(deviceId, new Set());
              sockets.get(deviceId)!.add(ws);
              await touchDevice(deviceId);
              ws.send(JSON.stringify({ type: 'messages', messages: await pending(deviceId) }));
            } else if (frame.type === 'ack' && deviceId) {
              await ack(deviceId, frame.ids);
            } else if (frame.type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong' }));
            }
          },
          onClose() {
            if (deviceId && self) {
              const open = sockets.get(deviceId);
              open?.delete(self);
              if (open && open.size === 0) sockets.delete(deviceId);
            }
          },
        };
      }),
    );
  }

  /* ---------- sender side (RFC 8030 §5) ---------- */
  app.post('/:token', async (c) => {
    const token = c.req.param('token');
    const r = await db().execute({
      sql: 'SELECT device_id, origin, app_key, deleted_at FROM push_subscriptions WHERE token = ?',
      args: [token],
    });
    const sub = r.rows[0] as any;
    // 404/410 is how senders learn to delete a subscription.
    if (!sub) return c.json({ error: 'no such subscription' }, 404);
    if (sub.deleted_at) return c.json({ error: 'subscription expired' }, 410);

    const vapid = verifyVapid(
      { authorization: c.req.header('authorization'), cryptoKey: c.req.header('crypto-key') },
      audience,
      sub.app_key ?? null,
      now(),
    );
    if (!vapid.ok) return c.json({ error: vapid.error }, vapid.status);

    const ttlHeader = c.req.header('ttl');
    if (ttlHeader == null || !/^\d+$/.test(ttlHeader.trim())) return c.json({ error: 'TTL header required' }, 400);
    const ttl = Math.min(Number(ttlHeader), MAX_TTL);

    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.length > MAX_PAYLOAD) return c.json({ error: `payload over ${MAX_PAYLOAD} bytes` }, 413);
    const encoding = c.req.header('content-encoding')?.toLowerCase() ?? null;
    if (body.length > 0 && encoding !== 'aes128gcm') {
      return c.json({ error: 'Content-Encoding must be aes128gcm (RFC 8291)' }, 415);
    }
    if (overLimit(token)) return c.json({ error: 'too many pushes to this subscription' }, 429);

    const urgency = /^(very-low|low|normal|high)$/.test(c.req.header('urgency') ?? '') ? c.req.header('urgency')! : 'normal';
    const topic = c.req.header('topic') && /^[A-Za-z0-9_-]{1,32}$/.test(c.req.header('topic')!) ? c.req.header('topic')! : null;
    const message: PushMessage = {
      id: id(),
      token,
      origin: sub.origin,
      body: Buffer.from(body).toString('base64url'),
      encoding: body.length > 0 ? encoding : null,
    };
    const deviceId = String(sub.device_id);

    // Stored even with a live socket: it stays until the browser acks, so a
    // push is not lost if the socket dies mid-send. TTL 0 = deliver now or never.
    if (topic) {
      await db().execute({ sql: 'DELETE FROM push_messages WHERE token = ? AND topic = ?', args: [token, topic] });
    }
    if (ttl > 0 || sockets.has(deviceId)) {
      await db().execute({
        sql: `INSERT INTO push_messages (id, token, device_id, body, encoding, urgency, topic, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [message.id, token, deviceId, message.body, message.encoding, urgency, topic,
          Math.floor(now() / 1000) + Math.max(ttl, 60)],
      });
    }
    deliver(deviceId, message);

    c.header('Location', `${base}/m/${message.id}`);
    c.header('TTL', String(ttl));
    return c.body(null, 201);
  });

  /** Drop expired messages; call on a timer. */
  async function sweep() {
    await db().execute({ sql: 'DELETE FROM push_messages WHERE expires_at <= ?', args: [Math.floor(now() / 1000)] });
  }

  return { app, sweep, sockets };
}
