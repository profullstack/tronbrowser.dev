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
