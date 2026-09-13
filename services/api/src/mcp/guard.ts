/**
 * What a public, keyless browser relay has to refuse before it renders
 * anything: private and loopback targets (the container's own API, Railway's
 * private network, cloud metadata) and callers who lean on it too hard.
 * Pure functions plus one small token bucket, so the route is testable
 * without a browser.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type Verdict = { ok: true; url: string } | { ok: false; error: string };

const BLOCKED_HOST = /(^|\.)(localhost|local|internal|railway\.internal|home\.arpa)$/i;

/** True for loopback, link-local, RFC1918, CGNAT, multicast, unspecified, and their v6 forms. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return privateV4(ip);
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return privateV4(mapped[1] as string);
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7
    if (lower.startsWith('ff')) return true; // multicast
    return false;
  }
  return true; // not an address at all: refuse
}

function privateV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

export type Lookup = (host: string) => Promise<string[]>;

const defaultLookup: Lookup = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

/**
 * Only public http(s) URLs. The name is checked, then what it resolves to, so
 * `http://api.attacker.tld` pointing at 10.0.0.5 is refused before any engine
 * connects. (The engines re-resolve; Chromium also carries host-resolver rules
 * for the same ranges and Obscura blocks private targets itself.)
 */
export async function acceptableUrl(value: unknown, resolve: Lookup = defaultLookup): Promise<Verdict> {
  if (typeof value !== 'string' || !value.trim()) return { ok: false, error: 'url is required' };
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, error: `Not a URL: ${value}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: 'Only http(s) URLs are fetched' };
  if (url.username || url.password) return { ok: false, error: 'Credentials in the URL are not accepted' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || BLOCKED_HOST.test(host)) return { ok: false, error: `Refusing to fetch ${host || '(empty host)'}` };
  if (isIP(host)) {
    if (isPrivateAddress(host)) return { ok: false, error: `Refusing to fetch a private address (${host})` };
    return { ok: true, url: url.toString() };
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, error: `${host} does not resolve` };
  }
  if (!addresses.length) return { ok: false, error: `${host} does not resolve` };
  const bad = addresses.find(isPrivateAddress);
  if (bad) return { ok: false, error: `Refusing to fetch ${host}: it resolves to a private address` };
  return { ok: true, url: url.toString() };
}

/** Per-key token bucket: `burst` calls at once, refilled at `perMinute`. */
export class RateLimiter {
  readonly #buckets = new Map<string, { tokens: number; at: number }>();
  readonly #burst: number;
  readonly #perMs: number;
  readonly #now: () => number;

  constructor(options: { burst: number; perMinute: number; now?: () => number }) {
    this.#burst = options.burst;
    this.#perMs = options.perMinute / 60_000;
    this.#now = options.now ?? Date.now;
  }

  /** Take one token for `key`; false when the caller has to wait. */
  take(key: string): boolean {
    const now = this.#now();
    const bucket = this.#buckets.get(key) ?? { tokens: this.#burst, at: now };
    bucket.tokens = Math.min(this.#burst, bucket.tokens + (now - bucket.at) * this.#perMs);
    bucket.at = now;
    if (bucket.tokens < 1) {
      this.#buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.#buckets.set(key, bucket);
    if (this.#buckets.size > 10_000) this.#sweep(now);
    return true;
  }

  #sweep(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (now - bucket.at > 10 * 60_000) this.#buckets.delete(key);
    }
  }
}

/** The caller's address behind Railway's edge and Caddy: first hop of X-Forwarded-For. */
export function clientKey(headers: { get(name: string): string | undefined | null }): string {
  const forwarded = headers.get('x-forwarded-for') ?? '';
  const first = forwarded.split(',')[0]?.trim();
  return first || headers.get('x-real-ip') || 'unknown';
}
