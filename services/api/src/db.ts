import { createClient, type Client } from '@profullstack/libsql-pg';

let _db: Client | null = null;

const POSTGRES_URL = /^postgres(ql)?:\/\//i;

/**
 * The Postgres connection string, or a clear error.
 *
 * The API moved from Turso/libSQL to Postgres (2026-09). @profullstack/libsql-pg
 * keeps the @libsql/client surface (execute / rows / rowsAffected) over a pg
 * pool and rewrites the SQLite idioms in these queries per statement, so the
 * call sites below did not change. There is deliberately no fallback to a
 * file or libsql:// database: a misconfigured deploy fails here, loudly.
 *
 * DATABASE_URL is the setting; TRONBROWSER_DB_URL is accepted as an alias so
 * an existing deploy can be repointed by changing one value.
 */
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL || env.TRONBROWSER_DB_URL;
  if (!url) {
    const hint = env.TRONBROWSER_DB_PATH
      ? ' TRONBROWSER_DB_PATH is set but file databases are no longer supported: copy it into Postgres with `npx libsql-pg copy` and set DATABASE_URL.'
      : '';
    throw new Error(`DATABASE_URL is not set (expected postgres://user:pass@host:5432/tronbrowser).${hint}`);
  }
  if (!POSTGRES_URL.test(url)) {
    const scheme = url.split(':')[0];
    throw new Error(
      `DATABASE_URL must be a postgres:// or postgresql:// URL, got "${scheme}:". ` +
        'TronBrowser runs on Postgres only; libsql:// and file: databases are not supported. ' +
        'Move the data with `npx libsql-pg copy --from <that url> --to postgres://...`.',
    );
  }
  return url;
}

/** Throws unless the database URL points at Postgres. Call at process start to fail fast. */
export function assertDatabaseUrl(env: NodeJS.ProcessEnv = process.env): void {
  databaseUrl(env);
}

export function db(): Client {
  if (_db) return _db;
  _db = createClient({ url: databaseUrl() });
  return _db;
}

/** ISO-8601 UTC timestamp `ttlSeconds` from now. */
export function expiresAt(ttlSeconds: number, now: number = Date.now()): string {
  return new Date(now + ttlSeconds * 1000).toISOString();
}

export interface User {
  id: string;
  auth_method: string;
  coinpay_sub: string | null;
  email: string | null;
  email_verified: number;
}

export async function userByCoinpaySub(sub: string): Promise<User | null> {
  const r = await db().execute({ sql: 'SELECT * FROM users WHERE coinpay_sub = ?', args: [sub] });
  return (r.rows[0] as unknown as User) ?? null;
}

export async function userByEmail(email: string): Promise<(User & { password_hash: string | null }) | null> {
  const r = await db().execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
  return (r.rows[0] as unknown as User & { password_hash: string | null }) ?? null;
}

export async function createUser(u: {
  id: string;
  authMethod: string;
  coinpaySub?: string | null;
  email?: string | null;
  emailVerified?: boolean;
  passwordHash?: string | null;
}): Promise<void> {
  await db().execute({
    sql: `INSERT INTO users (id, auth_method, coinpay_sub, email, email_verified, password_hash)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [u.id, u.authMethod, u.coinpaySub ?? null, u.email ?? null, u.emailVerified ? 1 : 0, u.passwordHash ?? null],
  });
}

export async function setEmailVerified(userId: string): Promise<void> {
  await db().execute({ sql: 'UPDATE users SET email_verified = 1, updated_at = datetime(\'now\') WHERE id = ?', args: [userId] });
}

export async function createSession(token: string, userId: string, ttlSeconds: number): Promise<void> {
  // Hand-ported: datetime('now', ?) with a BOUND modifier is not something the
  // libsql-pg rewriter can turn into now() + interval (the modifier has to be
  // a literal), so the expiry is computed here and bound as an ISO string
  // (expires_at is timestamptz in migrations-pg).
  await db().execute({
    sql: 'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
    args: [token, userId, expiresAt(ttlSeconds)],
  });
}

export async function userBySession(token: string): Promise<User | null> {
  const r = await db().execute({
    sql: `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token = ? AND s.expires_at > datetime('now')`,
    args: [token],
  });
  return (r.rows[0] as unknown as User) ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await db().execute({ sql: 'DELETE FROM sessions WHERE token = ?', args: [token] });
}

export async function putEmailToken(token: string, userId: string, purpose: string, ttlSeconds: number): Promise<void> {
  // Same hand port as createSession: the expiry is bound, not computed in SQL.
  await db().execute({
    sql: 'INSERT INTO email_tokens (token, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)',
    args: [token, userId, purpose, expiresAt(ttlSeconds)],
  });
}

export async function consumeEmailToken(token: string, purpose: string): Promise<string | null> {
  const r = await db().execute({
    sql: "SELECT user_id FROM email_tokens WHERE token = ? AND purpose = ? AND expires_at > datetime('now')",
    args: [token, purpose],
  });
  const userId = (r.rows[0]?.user_id as string) ?? null;
  if (userId) await db().execute({ sql: 'DELETE FROM email_tokens WHERE token = ?', args: [token] });
  return userId;
}

export async function getSettings(userId: string): Promise<unknown> {
  const r = await db().execute({ sql: 'SELECT settings FROM user_settings WHERE user_id = ?', args: [userId] });
  return r.rows[0] ? JSON.parse(r.rows[0].settings as string) : {};
}

export async function putSettings(userId: string, settings: unknown): Promise<void> {
  await db().execute({
    sql: `INSERT INTO user_settings (user_id, settings, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET settings = excluded.settings, updated_at = datetime('now')`,
    args: [userId, JSON.stringify(settings ?? {})],
  });
}
