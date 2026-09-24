// VAPID (RFC 8292) as a push service sees it: read the sender's key and JWT
// from the Authorization header and check the signature, audience and expiry.
// node:crypto only; no dependency.
import { createPublicKey, verify } from 'node:crypto';

export type VapidResult =
  | { ok: true; key: string; subject: string | null }
  | { ok: false; status: 401 | 403; error: string };

const b64u = (s: string) => Buffer.from(s, 'base64url');

/** A raw uncompressed P-256 point (65 bytes, 0x04 || x || y) as a KeyObject. */
export function p256PublicKey(raw: Buffer) {
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('not an uncompressed P-256 point');
  return createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') },
    format: 'jwk',
  });
}

/**
 * The key and JWT from `Authorization: vapid t=<jwt>, k=<key>` (RFC 8292), or
 * the older draft form `Authorization: WebPush <jwt>` + `Crypto-Key: p256ecdsa=<key>`
 * that some libraries still send.
 */
export function parseVapid(authorization: string | undefined, cryptoKey: string | undefined): { jwt: string; key: string } | null {
  if (!authorization) return null;
  const vapid = /^vapid\s+(.+)$/i.exec(authorization.trim());
  if (vapid) {
    const params = Object.fromEntries(
      vapid[1]!.split(',').map((part) => {
        const i = part.indexOf('=');
        return [part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim()];
      }),
    );
    return params.t && params.k ? { jwt: params.t, key: params.k } : null;
  }
  const legacy = /^webpush\s+(\S+)$/i.exec(authorization.trim());
  const key = /p256ecdsa=([A-Za-z0-9_-]+)/.exec(cryptoKey ?? '')?.[1];
  return legacy && key ? { jwt: legacy[1]!, key } : null;
}

/**
 * Verify a push request's VAPID credentials against the endpoint's origin.
 * `expectedKey` is the applicationServerKey the site subscribed with; a
 * different key is a 403 (RFC 8292 §4.2), anything unreadable a 401.
 */
export function verifyVapid(
  headers: { authorization?: string | undefined; cryptoKey?: string | undefined },
  audience: string,
  expectedKey: string | null,
  now = Date.now(),
): VapidResult {
  const parsed = parseVapid(headers.authorization, headers.cryptoKey);
  if (!parsed) {
    return expectedKey
      ? { ok: false, status: 401, error: 'VAPID authorization required' }
      : { ok: true, key: '', subject: null };
  }
  const [h, p, s] = parsed.jwt.split('.');
  if (!h || !p || !s) return { ok: false, status: 401, error: 'malformed JWT' };
  let header: any, claims: any, key;
  try {
    header = JSON.parse(b64u(h).toString());
    claims = JSON.parse(b64u(p).toString());
    key = p256PublicKey(b64u(parsed.key));
  } catch {
    return { ok: false, status: 401, error: 'unreadable VAPID key or JWT' };
  }
  if (header.alg !== 'ES256') return { ok: false, status: 401, error: 'JWT must be ES256' };
  const good = verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, b64u(s));
  if (!good) return { ok: false, status: 401, error: 'bad VAPID signature' };
  const seconds = Math.floor(now / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= seconds) return { ok: false, status: 401, error: 'JWT expired' };
  if (claims.exp > seconds + 24 * 3600 + 300) return { ok: false, status: 401, error: 'JWT exp more than 24h ahead' };
  if (claims.aud !== audience) return { ok: false, status: 401, error: `JWT aud must be ${audience}` };
  if (expectedKey && parsed.key.replace(/=+$/, '') !== expectedKey) {
    return { ok: false, status: 403, error: 'VAPID key does not match the subscription' };
  }
  return { ok: true, key: parsed.key, subject: typeof claims.sub === 'string' ? claims.sub : null };
}
