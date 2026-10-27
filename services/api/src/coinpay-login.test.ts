import { describe, expect, it } from 'vitest';
import { coinpayEmail, releasableEmailHolder, resolveCoinpayUser, type CoinpayUser } from './coinpay-login.js';

function fakeDb(seed: CoinpayUser[]) {
  const rows = [...seed];
  let n = 0;
  return {
    rows,
    deps: {
      userByCoinpaySub: async (sub: string) => rows.find((r) => r.coinpay_sub === sub) ?? null,
      userByEmail: async (email: string) => rows.find((r) => r.email === email) ?? null,
      createUser: async (u: { id: string; authMethod: string; coinpaySub: string; email: string | null; emailVerified: boolean }) => {
        if (u.email && rows.some((r) => r.email === u.email)) throw new Error('duplicate key value violates unique constraint "users_email_key"');
        rows.push({ id: u.id, auth_method: u.authMethod, coinpay_sub: u.coinpaySub, email: u.email, email_verified: u.emailVerified ? 1 : 0 });
      },
      newId: () => `new-${++n}`,
    },
  };
}

const victim: CoinpayUser = {
  id: 'victim', auth_method: 'password', coinpay_sub: null, email: 'victim@example.com', email_verified: 1, password_hash: 'hash',
};

describe('resolveCoinpayUser', () => {
  it('does not hand a CoinPay login the account of a victim with the same email', async () => {
    const { deps, rows } = fakeDb([victim]);
    const user = await resolveCoinpayUser(deps, 'attacker-sub', { sub: 'attacker-sub', email: 'victim@example.com', email_verified: true });
    expect(user.id).not.toBe('victim');
    expect(user.email).toBeNull();
    expect(user.email_verified).toBe(0);
    expect(rows.find((r) => r.id === 'victim')).toEqual(victim);
  });

  it('does not link to an account bound to another CoinPay sub', async () => {
    const other: CoinpayUser = { id: 'other', auth_method: 'coinpay', coinpay_sub: 'sub-a', email: 'a@example.com', email_verified: 0 };
    const { deps } = fakeDb([other]);
    const user = await resolveCoinpayUser(deps, 'sub-b', { email: 'a@example.com' });
    expect(user.id).not.toBe('other');
    expect(user.coinpay_sub).toBe('sub-b');
  });

  it('returns the account bound to the sub', async () => {
    const mine: CoinpayUser = { id: 'mine', auth_method: 'coinpay', coinpay_sub: 'sub-1', email: 'x@example.com', email_verified: 0 };
    const { deps } = fakeDb([mine, victim]);
    expect((await resolveCoinpayUser(deps, 'sub-1', { email: 'victim@example.com' })).id).toBe('mine');
  });

  it('never marks a CoinPay email verified, even when userinfo claims it or omits the flag', async () => {
    const { deps, rows } = fakeDb([]);
    await resolveCoinpayUser(deps, 's1', { email: 'one@example.com', email_verified: true });
    await resolveCoinpayUser(deps, 's2', { email: 'two@example.com' });
    expect(rows.map((r) => [r.email, r.email_verified])).toEqual([['one@example.com', 0], ['two@example.com', 0]]);
  });

  it('falls back to no email when it loses a race for the address', async () => {
    const { deps, rows } = fakeDb([]);
    const racing = { ...deps, userByEmail: async () => null };
    rows.push({ ...victim });
    const user = await resolveCoinpayUser(racing, 's3', { email: 'victim@example.com' });
    expect(user.email).toBeNull();
  });
});

describe('releasableEmailHolder', () => {
  it('releases only an unverified, password-less CoinPay account', () => {
    expect(releasableEmailHolder({ id: 'c', auth_method: 'coinpay', coinpay_sub: 's', email: 'e@x.io', email_verified: 0, password_hash: null })).toBe(true);
    expect(releasableEmailHolder({ id: 'c', auth_method: 'coinpay', coinpay_sub: 's', email: 'e@x.io', email_verified: 1, password_hash: null })).toBe(false);
    expect(releasableEmailHolder(victim)).toBe(false);
    expect(releasableEmailHolder({ ...victim, email_verified: 0 })).toBe(false);
    expect(releasableEmailHolder(null)).toBe(false);
  });
});

describe('coinpayEmail', () => {
  it('trims and rejects junk', () => {
    expect(coinpayEmail({ email: '  a@b.co ' })).toBe('a@b.co');
    expect(coinpayEmail({ email: 'nope' })).toBeNull();
    expect(coinpayEmail({})).toBeNull();
  });
});
