/**
 * Which TronBrowser account a "Sign in with CoinPay" callback lands in.
 *
 * CoinPay does not verify email addresses: anyone can open a CoinPay account
 * under someone else's address, and userinfo reports email_verified=false (or
 * omits it). So the only identity CoinPay proves is its `sub`.
 *
 *  - The account bound to this sub is the one we sign into. Nothing else is.
 *  - A new CoinPay account never takes an email another account already holds,
 *    and its email is never marked verified, whatever CoinPay says.
 *  - Because that email is unproven, a password signup for the same address
 *    may take it back from a CoinPay-only account that never verified it
 *    (see `releasableEmailHolder`), so a squatter cannot block the real owner.
 */

export interface CoinpayUser {
  id: string;
  auth_method: string;
  coinpay_sub: string | null;
  email: string | null;
  email_verified: number;
  password_hash?: string | null;
}

export interface CoinpayLoginDeps {
  userByCoinpaySub(sub: string): Promise<CoinpayUser | null>;
  userByEmail(email: string): Promise<CoinpayUser | null>;
  createUser(u: { id: string; authMethod: string; coinpaySub: string; email: string | null; emailVerified: boolean }): Promise<void>;
  newId(): string;
}

/** The CoinPay userinfo email, trimmed, or null. Never treated as verified. */
export function coinpayEmail(info: Record<string, unknown>): string | null {
  const e = typeof info.email === 'string' ? info.email.trim() : '';
  return e && e.length <= 254 && e.includes('@') ? e : null;
}

export async function resolveCoinpayUser(
  deps: CoinpayLoginDeps,
  sub: string,
  info: Record<string, unknown>,
): Promise<CoinpayUser> {
  const bound = await deps.userByCoinpaySub(sub);
  if (bound) return bound;

  // Never link to, and never collide with, an account that already has this
  // address: keep the CoinPay account separate and email-less instead.
  let email = coinpayEmail(info);
  if (email && (await deps.userByEmail(email))) email = null;

  const id = deps.newId();
  try {
    await deps.createUser({ id, authMethod: 'coinpay', coinpaySub: sub, email, emailVerified: false });
  } catch (err) {
    // Lost a race for the unique email: create the account without it.
    if (!email) throw err;
    email = null;
    await deps.createUser({ id, authMethod: 'coinpay', coinpaySub: sub, email: null, emailVerified: false });
  }
  return { id, auth_method: 'coinpay', coinpay_sub: sub, email, email_verified: 0 };
}

/**
 * True when `holder` keeps `email` only on CoinPay's say-so: a CoinPay-only
 * account (no password) whose email was never verified by us. A password
 * signup for that address may release it from the holder.
 */
export function releasableEmailHolder(holder: CoinpayUser | null): boolean {
  return !!holder && holder.auth_method === 'coinpay' && !holder.password_hash && !holder.email_verified;
}

/* ---------------------------------------------------------------- connect -- */

export type ConnectResult = { ok: true } | { ok: false; code: 'not_signed_in' | 'linked_elsewhere' | 'already_connected' };

/**
 * Connect CoinPay to the signed-in account (settings). Only ever with a session:
 * a CoinPay login never claims an account by its email.
 */
export async function connectCoinpay(
  deps: {
    userByCoinpaySub(sub: string): Promise<CoinpayUser | null>;
    linkCoinpaySub(userId: string, sub: string): Promise<'ok' | 'conflict'>;
  },
  current: { id: string; coinpay_sub: string | null } | null,
  sub: string,
): Promise<ConnectResult> {
  if (!current) return { ok: false, code: 'not_signed_in' };
  const bound = await deps.userByCoinpaySub(sub);
  if (bound) return bound.id === current.id ? { ok: true } : { ok: false, code: 'linked_elsewhere' };
  if (current.coinpay_sub) return { ok: false, code: 'already_connected' };
  return (await deps.linkCoinpaySub(current.id, sub)) === 'ok' ? { ok: true } : { ok: false, code: 'linked_elsewhere' };
}

/* ---------------------------------------------------- pending OAuth request -- */

/**
 * What the start route keeps in a short-lived httpOnly cookie: state, the OIDC
 * nonce, the PKCE verifier, the mode, and where to land.
 */
export interface PendingCoinpay {
  state: string;
  nonce: string;
  verifier: string;
  mode: 'login' | 'connect';
  redirect: string;
}

export function encodePending(p: PendingCoinpay): string {
  return Buffer.from(JSON.stringify({ s: p.state, n: p.nonce, v: p.verifier, m: p.mode, r: p.redirect })).toString('base64url');
}

export function decodePending(raw: string | undefined | null): PendingCoinpay | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!o || typeof o.s !== 'string' || typeof o.n !== 'string' || typeof o.v !== 'string') return null;
    if (o.m !== 'login' && o.m !== 'connect') return null;
    return { state: o.s, nonce: o.n, verifier: o.v, mode: o.m, redirect: typeof o.r === 'string' ? o.r : '' };
  } catch {
    return null;
  }
}

/** The CoinPay issuer from an endpoint URL (`<issuer>/api/oauth/<x>`), else the hosted one. */
export function coinpayIssuer(endpoint: string | undefined): string {
  const m = /^(https?:\/\/[^/]+(?:\/.*?)?)\/api\/oauth\/[a-z_]+\/?$/.exec(String(endpoint ?? ''));
  return m?.[1] ?? 'https://coinpayportal.com';
}
