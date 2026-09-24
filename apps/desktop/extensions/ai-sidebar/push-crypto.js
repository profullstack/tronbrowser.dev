// The browser end of Web Push encryption (RFC 8291 over RFC 8188 aes128gcm),
// in WebCrypto only, so it runs in the extension's service worker and in node
// tests alike. Browsers normally do this inside their push stack; TronBrowser's
// engine has none, so the extension holds the subscription keys itself.

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();

export function toB64u(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(text) {
  const normal = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(normal + '==='.slice((normal.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

async function hkdf(salt, ikm, info, length) {
  const key = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/**
 * A fresh subscription keypair: `p256dh` (public, raw 65 bytes) and `auth`
 * (16 random bytes) go to the site; `privateJwk` never leaves the extension.
 */
export async function createSubscriptionKeys() {
  const pair = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  const privateJwk = await subtle().exportKey('jwk', pair.privateKey);
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { p256dh: toB64u(raw), auth: toB64u(auth), privateJwk };
}

/**
 * Decrypt one aes128gcm Web Push body with the subscription's keys.
 * Returns the plaintext bytes. Throws on anything malformed or forged.
 */
export async function decryptPush(body, keys) {
  const data = body instanceof Uint8Array ? body : new Uint8Array(body);
  if (data.length < 21) throw new Error('push body too short');
  const salt = data.subarray(0, 16);
  const rs = new DataView(data.buffer, data.byteOffset + 16, 4).getUint32(0);
  const idlen = data[20];
  const senderPublic = data.subarray(21, 21 + idlen);
  const ciphertext = data.subarray(21 + idlen);
  if (idlen !== 65 || senderPublic[0] !== 4) throw new Error('push body has no sender key');
  if (ciphertext.length > rs) throw new Error('multi-record push bodies are not used by Web Push');

  const receiverPublic = fromB64u(keys.p256dh);
  const privateKey = await subtle().importKey('jwk', keys.privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const senderKey = await subtle().importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: senderKey }, privateKey, 256));

  // RFC 8291 §3.4: mix the auth secret and both public keys into the IKM.
  const ikm = await hkdf(fromB64u(keys.auth), shared,
    concat(enc.encode('WebPush: info\0'), receiverPublic, senderPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await subtle().importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: nonce }, aes, ciphertext));
  // Single (last) record: content, then 0x02, then zero padding.
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (end < 0 || padded[end] !== 2) throw new Error('bad push padding');
  return padded.subarray(0, end);
}

/**
 * What to show for a decrypted payload. Understands the common shapes: our
 * house `{ title, body, url, icon }`, FCM-style `{ notification: {...} }`, and
 * plain text. Anything else becomes the body.
 */
export function notificationFromPayload(text, origin) {
  let data;
  try { data = JSON.parse(text); } catch { data = { body: text }; }
  if (typeof data !== 'object' || data === null) data = { body: String(data) };
  const n = typeof data.notification === 'object' && data.notification ? { ...data, ...data.notification } : data;
  const host = (() => { try { return new URL(origin).host; } catch { return origin; } })();
  const title = String(n.title || host).slice(0, 200);
  const body = String(n.body ?? n.message ?? '').slice(0, 1000);
  const rawUrl = n.url ?? n.click_action ?? n.data?.url ?? '/';
  let url = origin;
  try {
    const resolved = new URL(rawUrl, origin);
    if (resolved.protocol === 'https:' || resolved.protocol === 'http:') url = resolved.href;
  } catch { /* keep the origin */ }
  let icon = null;
  try { if (n.icon) icon = new URL(n.icon, origin).href; } catch { /* no icon */ }
  return { title, body, url, icon, host };
}
