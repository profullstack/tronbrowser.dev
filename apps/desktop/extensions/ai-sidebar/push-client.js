// Web Push for TronBrowser, background side.
//
// ungoogled-chromium ships without a push service, so every site's
// pushManager.subscribe() fails with "Registration failed - push service
// error". push-page.js replaces pushManager in pages; this module does the
// work: holds each subscription's keys, registers with the configured push
// service, keeps a socket to it, decrypts what arrives and shows it.
//
// The push service is a setting (`pushService` in chrome.storage.local):
//   unset / DEFAULT_PUSH_SERVICE  TronBrowser's own, https://tronbrowser.dev/api/1/push
//   any https URL                 a compatible service (self-hosted, say)
//   'off'                         leave pushManager alone (the engine's own behaviour)
import { createSubscriptionKeys, decryptPush, fromB64u, notificationFromPayload, toB64u } from './push-crypto.js';

export const DEFAULT_PUSH_SERVICE = 'https://tronbrowser.dev/api/1/push';
const SUBS_KEY = 'pushSubscriptions';   // { [origin|scope]: { token, endpoint, p256dh, auth, privateJwk, appKey, service } }
const PING_MS = 20_000;                 // keeps the socket, and so this worker, alive (Chrome 116+)

/** The configured push service URL, or null when push is switched off. */
export function pushServiceFrom(value) {
  if (value === 'off') return null;
  if (typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value.trim())) return value.trim().replace(/\/$/, '');
  if (typeof value === 'string' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(value.trim())) return value.trim().replace(/\/$/, '');
  return DEFAULT_PUSH_SERVICE;
}

async function service() {
  const { pushService } = await chrome.storage.local.get('pushService');
  return pushServiceFrom(pushService);
}

async function deviceSecret() {
  const { pushDeviceSecret } = await chrome.storage.local.get('pushDeviceSecret');
  if (pushDeviceSecret) return pushDeviceSecret;
  const secret = toB64u(crypto.getRandomValues(new Uint8Array(32)));
  await chrome.storage.local.set({ pushDeviceSecret: secret });
  return secret;
}

async function subscriptions() {
  return (await chrome.storage.local.get(SUBS_KEY))[SUBS_KEY] || {};
}

const subKey = (origin, scope) => `${origin}|${scope || origin + '/'}`;

/** What the page sees: the same shape PushSubscription.toJSON() gives. */
function publicShape(sub) {
  return { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth }, applicationServerKey: sub.appKey };
}

async function api(base, path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await deviceSecret()}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `push service answered ${res.status}`);
  return body;
}

export async function subscribe(origin, scope, appKey) {
  const base = await service();
  if (!base) return { off: true };
  const all = await subscriptions();
  const key = subKey(origin, scope);
  const existing = all[key];
  if (existing && existing.service === base) {
    if ((existing.appKey || null) === (appKey || null)) return { subscription: publicShape(existing) };
    // Native behaviour: a different key on an existing subscription is an error.
    return { error: 'InvalidStateError', message: 'A subscription with a different applicationServerKey already exists.' };
  }
  const keys = await createSubscriptionKeys();
  const created = await api(base, '/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ origin, applicationServerKey: appKey || null }),
  });
  all[key] = { ...keys, token: created.token, endpoint: created.endpoint, appKey: appKey || null, service: base, origin };
  await chrome.storage.local.set({ [SUBS_KEY]: all });
  connect();
  return { subscription: publicShape(all[key]) };
}

export async function getSubscription(origin, scope) {
  const base = await service();
  if (!base) return { off: true };
  const sub = (await subscriptions())[subKey(origin, scope)];
  return { subscription: sub && sub.service === base ? publicShape(sub) : null };
}

export async function unsubscribe(origin, scope) {
  const all = await subscriptions();
  const key = subKey(origin, scope);
  const sub = all[key];
  if (!sub) return { ok: false };
  delete all[key];
  await chrome.storage.local.set({ [SUBS_KEY]: all });
  await api(sub.service, `/subscriptions/${sub.token}`, { method: 'DELETE' }).catch(() => undefined);
  return { ok: true };
}

/* ---------- receiving ---------- */

async function show(message) {
  const sub = Object.values(await subscriptions()).find((s) => s.token === message.token);
  if (!sub) return; // unsubscribed since; the ack still clears it
  // Respect the site's notification permission if the user has since blocked it.
  if (chrome.contentSettings?.notifications) {
    const { setting } = await chrome.contentSettings.notifications.get({ primaryUrl: `${sub.origin}/` }).catch(() => ({}));
    if (setting === 'block') return;
  }
  let text = '';
  if (message.body) text = new TextDecoder().decode(await decryptPush(fromB64u(message.body), sub));
  const n = notificationFromPayload(text, sub.origin);
  const id = `push:${message.id}`;
  const options = {
    type: 'basic',
    iconUrl: n.icon || chrome.runtime.getURL('icons/icon-128.png'),
    title: n.title,
    message: n.body || n.host,
    contextMessage: n.host,
  };
  try {
    await chrome.notifications.create(id, options);
  } catch {
    await chrome.notifications.create(id, { ...options, iconUrl: chrome.runtime.getURL('icons/icon-128.png') });
  }
  await chrome.storage.session.set({ [id]: n.url });
}

async function handle(messages, ackVia) {
  const ids = [];
  for (const message of messages || []) {
    try { await show(message); } catch (error) { console.warn('[push] could not show a message', error); }
    ids.push(message.id); // an unreadable push will not become readable later
  }
  if (ids.length) await ackVia(ids);
}

let socket = null;
let pinger = null;

export async function connect() {
  const base = await service();
  if (!base || socket) return;
  if (!Object.values(await subscriptions()).some((s) => s.service === base)) return;
  const secret = await deviceSecret();
  let ws;
  try { ws = new WebSocket(`${base.replace(/^http/, 'ws')}/connect`); } catch { return; }
  socket = ws;
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'hello', secret }));
    pinger = setInterval(() => { try { ws.send(JSON.stringify({ type: 'ping' })); } catch { /* closing */ } }, PING_MS);
  };
  ws.onmessage = (event) => {
    let frame;
    try { frame = JSON.parse(event.data); } catch { return; }
    if (frame.type === 'messages') {
      handle(frame.messages, async (ids) => ws.send(JSON.stringify({ type: 'ack', ids })));
    }
  };
  ws.onclose = () => {
    clearInterval(pinger);
    if (socket === ws) socket = null;
  };
}

/** The fallback when the socket was down: fetch and show whatever is waiting. */
export async function poll() {
  const base = await service();
  if (!base) return;
  if (!Object.values(await subscriptions()).some((s) => s.service === base)) return;
  const { messages } = await api(base, '/messages');
  await handle(messages, (ids) => api(base, '/ack', { method: 'POST', body: JSON.stringify({ ids }) }));
}

export function installPush() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (typeof msg?.type !== 'string' || !msg.type.startsWith('push:')) return false;
    // The origin comes from Chrome, never from the page: a site can only
    // manage its own subscriptions.
    const origin = sender.origin || (sender.url ? new URL(sender.url).origin : null);
    if (!origin || !/^https:|^http:\/\/(localhost|127\.0\.0\.1)/.test(origin)) {
      sendResponse({ error: 'NotSupportedError', message: 'Push needs a secure origin.' });
      return false;
    }
    const run = {
      'push:subscribe': () => subscribe(origin, msg.scope, msg.applicationServerKey),
      'push:get': () => getSubscription(origin, msg.scope),
      'push:unsubscribe': () => unsubscribe(origin, msg.scope),
    }[msg.type];
    if (!run) return false;
    run().then(sendResponse, (error) => sendResponse({ error: 'AbortError', message: `Registration failed - ${error.message}` }));
    return true;
  });

  chrome.notifications?.onClicked?.addListener(async (id) => {
    if (!id.startsWith('push:')) return;
    const url = (await chrome.storage.session.get(id))[id];
    if (url) chrome.tabs.create({ url });
    chrome.notifications.clear(id);
    chrome.storage.session.remove(id);
  });
  chrome.notifications?.onClosed?.addListener((id) => {
    if (id.startsWith('push:')) chrome.storage.session.remove(id);
  });

  // A changed service strands the old subscriptions; forget them so sites
  // see no subscription and subscribe again against the new one.
  chrome.storage?.onChanged?.addListener(async (changes, area) => {
    if (area !== 'local' || !changes.pushService) return;
    socket?.close();
    const base = await service();
    const all = await subscriptions();
    for (const [key, sub] of Object.entries(all)) if (sub.service !== base) delete all[key];
    await chrome.storage.local.set({ [SUBS_KEY]: all });
    connect();
  });

  chrome.alarms?.create('push-poll', { periodInMinutes: 1 });
  chrome.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm.name !== 'push-poll') return;
    if (!socket) connect();
    poll().catch(() => undefined);
  });
  chrome.runtime.onStartup?.addListener(() => { connect(); poll().catch(() => undefined); });
  connect().catch(() => undefined);
}
