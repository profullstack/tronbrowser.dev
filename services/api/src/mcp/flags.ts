/**
 * The relay's memory of broken targets (fleet crawler rule, 2026-11-08: slow or
 * broken pages are flagged and left alone for a month).
 *
 * Before this, every Infernet search re-rendered the same dead page and spent
 * the full budget on it each time. Now a failure that is the TARGET's fault is
 * recorded, and for 30 days a call for it answers at once with a typed
 * "flagged until <date>" error instead of rendering:
 *
 * - load timeout or HTTP 5xx: flagged by URL (the rest of the site may be fine);
 * - DNS, TLS, refused/reset/unreachable connection: flagged by HOST, because no
 *   page on it can load.
 *
 * After 30 days the first call gets exactly one recheck (it claims the flag with
 * a short lease, so parallel callers do not all retry): success clears the flag,
 * failure flags it for another 30 days. Errors that are ours (busy, rate limit,
 * engine missing, bad URL) or that are not "broken" (bot walls, 4xx) never flag.
 *
 * Storage is the API's Postgres (table crawl_flags, migration 0010), so flags
 * survive deploys; without DATABASE_URL (tests, a local relay) a bounded
 * in-memory map stands in. A storage error never blocks a fetch: it is logged
 * and the page is fetched as if unflagged.
 */

export const CRAWL_FLAG_DAYS = 30;
export const CRAWL_FLAG_MS = CRAWL_FLAG_DAYS * 24 * 60 * 60 * 1000;
/** How long a claimed recheck holds the flag before another caller may try. */
export const RECHECK_LEASE_MS = 2 * 60 * 1000;
/** Prefix of the error text a flagged target answers with; callers match on it. */
export const FLAGGED_PREFIX = 'FLAGGED until';

export type FlagScope = 'url' | 'host';
export type FlagReason = 'timeout' | 'connection' | 'http_5xx' | 'network';

export interface CrawlFlag {
  target: string;
  scope: FlagScope;
  reason: FlagReason;
  lastError: string;
  failedAt: string;
  nextCheckAt: string;
  failCount: number;
}

export interface FlagStore {
  /** Flags for any of these targets. */
  get(targets: string[]): Promise<CrawlFlag[]>;
  /** Take the one recheck for an expired flag: true if this caller got it. */
  claim(target: string, now: number): Promise<boolean>;
  /** Record a failure: flag (or re-flag) for CRAWL_FLAG_MS. */
  flag(f: { target: string; scope: FlagScope; reason: FlagReason; lastError: string }, now: number): Promise<CrawlFlag>;
  /** A success: forget these targets. */
  clear(targets: string[]): Promise<void>;
}

/** Thrown instead of fetching a flagged target. */
export class FlaggedTargetError extends Error {
  readonly code = 'FLAGGED' as const;
  readonly flag: CrawlFlag;
  constructor(flag: CrawlFlag) {
    super(
      `${FLAGGED_PREFIX} ${flag.nextCheckAt}: ${flag.scope} ${flag.target.replace(/^(url|host):/, '')} failed ` +
        `(${flag.reason}: ${flag.lastError}) at ${flag.failedAt}; not fetched again before then`,
    );
    this.name = 'FlaggedTargetError';
    this.flag = flag;
  }
}

/** The two flag keys a URL is checked under. */
export function flagTargets(url: string): { url: string; host: string } {
  const u = new URL(url);
  u.hash = '';
  return { url: `url:${u.toString()}`, host: `host:${u.hostname.toLowerCase()}` };
}

/** net::ERR_* codes that mean the host itself cannot be reached. */
const HOST_ERRORS =
  /ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|ERR_ADDRESS_UNREACHABLE|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_FAILED|ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|ERR_EMPTY_RESPONSE|ERR_SSL_|ERR_CERT_|ERR_BAD_SSL_CLIENT_AUTH_CERT|ERR_TUNNEL_CONNECTION_FAILED/;

/**
 * Whether a fetch failure is the target's fault, and what to flag. Null for
 * everything else: our own errors (busy, engine missing, bad input), bot walls,
 * aborted downloads, or messages we do not recognise.
 */
export function classifyFailure(err: unknown, url: string): { target: string; scope: FlagScope; reason: FlagReason; lastError: string } | null {
  const t = flagTargets(url);
  const message = err instanceof Error ? err.message : String(err);
  const lastError = message.slice(0, 300);
  if (err instanceof FlaggedTargetError) return null;
  const status = (err as { status?: unknown })?.status;
  if ((err as { code?: unknown })?.code === 'HTTP_STATUS' && typeof status === 'number' && status >= 500) {
    return { target: t.url, scope: 'url', reason: 'http_5xx', lastError };
  }
  if ((err as { code?: unknown })?.code === 'PAGE_LOAD_TIMEOUT') {
    return { target: t.url, scope: 'url', reason: 'timeout', lastError };
  }
  // browser-core NavigationError carries Chromium's net::ERR_* text; duck-typed so the
  // check survives the error crossing package copies.
  const nav = (err as { errorText?: unknown })?.errorText;
  const errorText = typeof nav === 'string' ? nav : message;
  if (HOST_ERRORS.test(errorText)) return { target: t.host, scope: 'host', reason: 'connection', lastError };
  if (/ERR_HTTP_RESPONSE_CODE_FAILURE/.test(errorText)) return { target: t.url, scope: 'url', reason: 'http_5xx', lastError };
  // Obscura pinned (no Chromium to say more): its navigate error is generic.
  if (/^Error: Network error/i.test(message) && !/private\/internal/i.test(message)) {
    return { target: t.url, scope: 'url', reason: 'network', lastError };
  }
  if (/Obscura timed out after \d+ms on tools\/call/.test(message)) return { target: t.url, scope: 'url', reason: 'timeout', lastError };
  return null;
}

/**
 * Run `work` for `url` behind the flag check. A live flag throws
 * FlaggedTargetError without calling `work`; an expired one gets one recheck.
 */
export async function withFlags<T>(
  store: FlagStore,
  url: string,
  work: () => Promise<T>,
  opts: { now?: () => number; log?: (line: string) => void } = {},
): Promise<T> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const t = flagTargets(url);
  const targets = [t.url, t.host];
  let found: CrawlFlag[] = [];
  try {
    found = await store.get(targets);
  } catch (err) {
    log(`flags: read failed, fetching anyway: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const f of found) {
    if (Date.parse(f.nextCheckAt) > now()) throw new FlaggedTargetError(f);
    let mine = true;
    try {
      mine = await store.claim(f.target, now());
    } catch (err) {
      log(`flags: claim failed, rechecking anyway: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!mine) throw new FlaggedTargetError({ ...f, nextCheckAt: new Date(now() + RECHECK_LEASE_MS).toISOString() });
    log(`flags: recheck ${f.target} (flagged ${f.failCount}x, last ${f.reason})`);
  }
  try {
    const out = await work();
    if (found.length) {
      await store.clear(found.map((f) => f.target)).catch((err) => log(`flags: clear failed: ${err instanceof Error ? err.message : String(err)}`));
      log(`flags: cleared ${found.map((f) => f.target).join(' ')}`);
    }
    return out;
  } catch (err) {
    const failure = classifyFailure(err, url);
    if (failure) {
      try {
        const f = await store.flag(failure, now());
        log(`flags: flagged ${f.target} until ${f.nextCheckAt} (${f.reason}, ${f.failCount}x): ${f.lastError}`);
      } catch (e) {
        log(`flags: write failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw err;
  }
}

/** Bounded in-memory store: oldest entries go first past `max`. For tests and DB-less relays. */
export function memoryFlagStore(max = 10_000): FlagStore & { size(): number } {
  const m = new Map<string, CrawlFlag>();
  return {
    size: () => m.size,
    async get(targets) {
      return targets.map((t) => m.get(t)).filter((f): f is CrawlFlag => Boolean(f));
    },
    async claim(target, now) {
      const f = m.get(target);
      if (!f || Date.parse(f.nextCheckAt) > now) return false;
      f.nextCheckAt = new Date(now + RECHECK_LEASE_MS).toISOString();
      return true;
    },
    async flag(f, now) {
      const prev = m.get(f.target);
      const next: CrawlFlag = {
        ...f,
        failedAt: new Date(now).toISOString(),
        nextCheckAt: new Date(now + CRAWL_FLAG_MS).toISOString(),
        failCount: (prev?.failCount ?? 0) + 1,
      };
      m.delete(f.target);
      m.set(f.target, next);
      while (m.size > max) m.delete(m.keys().next().value as string);
      return next;
    },
    async clear(targets) {
      for (const t of targets) m.delete(t);
    },
  };
}

/** The slice of @profullstack/libsql-pg's Client this needs. */
export interface SqlClient {
  execute(stmt: { sql: string; args: Array<string | number | null> }): Promise<{ rows: Array<Record<string, unknown>>; rowsAffected: number }>;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const rowToFlag = (r: Record<string, unknown>): CrawlFlag => ({
  target: String(r.target),
  scope: String(r.scope) as FlagScope,
  reason: String(r.reason) as FlagReason,
  lastError: String(r.last_error ?? ''),
  failedAt: iso(r.failed_at),
  nextCheckAt: iso(r.next_check_at),
  failCount: Number(r.fail_count ?? 1),
});

/** Postgres store over the crawl_flags table (packages/storage/migrations-pg/0010_crawl_flags.sql). */
export function sqlFlagStore(client: () => SqlClient): FlagStore {
  return {
    async get(targets) {
      if (!targets.length) return [];
      const r = await client().execute({
        sql: `SELECT target, scope, reason, last_error, failed_at, next_check_at, fail_count FROM crawl_flags WHERE target IN (${targets.map(() => '?').join(', ')})`,
        args: targets,
      });
      return r.rows.map(rowToFlag);
    },
    async claim(target, now) {
      const r = await client().execute({
        sql: 'UPDATE crawl_flags SET next_check_at = ? WHERE target = ? AND next_check_at <= ?',
        args: [new Date(now + RECHECK_LEASE_MS).toISOString(), target, new Date(now).toISOString()],
      });
      return r.rowsAffected > 0;
    },
    async flag(f, now) {
      const failedAt = new Date(now).toISOString();
      const nextCheckAt = new Date(now + CRAWL_FLAG_MS).toISOString();
      const r = await client().execute({
        sql: `INSERT INTO crawl_flags (target, scope, reason, last_error, failed_at, next_check_at, fail_count)
              VALUES (?, ?, ?, ?, ?, ?, 1)
              ON CONFLICT (target) DO UPDATE SET scope = excluded.scope, reason = excluded.reason,
                last_error = excluded.last_error, failed_at = excluded.failed_at,
                next_check_at = excluded.next_check_at, fail_count = crawl_flags.fail_count + 1
              RETURNING target, scope, reason, last_error, failed_at, next_check_at, fail_count`,
        args: [f.target, f.scope, f.reason, f.lastError, failedAt, nextCheckAt],
      });
      return r.rows[0] ? rowToFlag(r.rows[0]) : { ...f, failedAt, nextCheckAt, failCount: 1 };
    },
    async clear(targets) {
      if (!targets.length) return;
      await client().execute({ sql: `DELETE FROM crawl_flags WHERE target IN (${targets.map(() => '?').join(', ')})`, args: targets });
    },
  };
}
