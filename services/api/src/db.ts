import { createClient, type Client } from '@libsql/client';

let _db: Client | null = null;

export function db(): Client {
  if (_db) return _db;
  const url = process.env.TRONBROWSER_DB_URL;
  const authToken = process.env.TRONBROWSER_DB_AUTH_TOKEN;
  const path = process.env.TRONBROWSER_DB_PATH;
  if (path) _db = createClient({ url: 'file:' + path.replace(/^file:/, '') });
  else if (url && !/^(file:|\.\/|\/)/.test(url)) {
    if (!authToken) throw new Error('TRONBROWSER_DB_AUTH_TOKEN required for remote DB');
    _db = createClient({ url, authToken });
  } else if (url) _db = createClient({ url: url.startsWith('file:') ? url : 'file:' + url });
  else throw new Error('Set TRONBROWSER_DB_URL (+_AUTH_TOKEN) or TRONBROWSER_DB_PATH');
  return _db;
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
  await db().execute({
    sql: "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))",
    args: [token, userId, `+${ttlSeconds} seconds`],
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
  await db().execute({
    sql: "INSERT INTO email_tokens (token, user_id, purpose, expires_at) VALUES (?, ?, ?, datetime('now', ?))",
    args: [token, userId, purpose, `+${ttlSeconds} seconds`],
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
