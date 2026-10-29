import { describe, expect, it } from 'vitest';
import { authorizeUrl, checkIdToken, pkce, randomToken, sameState } from '@profullstack/coinpay-onboard/oauth';
import {
  coinpayEmail, coinpayIssuer, connectCoinpay, decodePending, encodePending, releasableEmailHolder, resolveCoinpayUser, type CoinpayUser,
} from './coinpay-login.js';

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


describe('connectCoinpay (settings)', () => {
  const linkFake = (rows: CoinpayUser[]) => ({
    userByCoinpaySub: async (sub: string) => rows.find((r) => r.coinpay_sub === sub) ?? null,
    linkCoinpaySub: async (id: string, sub: string) => {
      if (rows.some((r) => r.coinpay_sub === sub)) return 'conflict' as const;
      const u = rows.find((r) => r.id === id);
      if (!u || u.coinpay_sub) return 'conflict' as const;
      u.coinpay_sub = sub;
      return 'ok' as const;
    },
  });

  it('needs a signed-in session', async () => {
    const rows = [{ ...victim }];
    expect(await connectCoinpay(linkFake(rows), null, 's')).toEqual({ ok: false, code: 'not_signed_in' });
    expect(rows[0].coinpay_sub).toBeNull();
  });

  it('links the sub to the signed-in account, and a later CoinPay login reaches it', async () => {
    const rows = [{ ...victim }];
    const deps = linkFake(rows);
    expect(await connectCoinpay(deps, rows[0], 'vs')).toEqual({ ok: true });
    const { deps: loginDeps } = fakeDb(rows);
    expect((await resolveCoinpayUser(loginDeps, 'vs', { email: 'someone@else.example' })).id).toBe('victim');
  });

  it('refuses a sub bound to another account, or a second CoinPay account', async () => {
    const other: CoinpayUser = { id: 'o', auth_method: 'coinpay', coinpay_sub: 'taken', email: null, email_verified: 0 };
    const rows = [{ ...victim }, other];
    expect(await connectCoinpay(linkFake(rows), rows[0], 'taken')).toEqual({ ok: false, code: 'linked_elsewhere' });
    rows[0].coinpay_sub = 'mine';
    expect(await connectCoinpay(linkFake(rows), rows[0], 'new')).toEqual({ ok: false, code: 'already_connected' });
  });
});

describe('PKCE, state and nonce', () => {
  it('the authorize URL carries PKCE S256, state, nonce and the exact redirect', () => {
    const { verifier, challenge } = pkce();
    const state = randomToken();
    const nonce = randomToken();
    const u = new URL(authorizeUrl({ base: coinpayIssuer('https://coinpayportal.com/api/oauth/authorize'), clientId: 'cp_x', redirectUri: 'https://tronbrowser.dev/api/auth/coinpay/callback', scopes: ['openid', 'profile', 'email'], state, nonce, challenge }));
    expect(u.origin + u.pathname).toBe('https://coinpayportal.com/api/oauth/authorize');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBe(challenge);
    expect(u.searchParams.get('state')).toBe(state);
    expect(u.searchParams.get('nonce')).toBe(nonce);
    expect(u.searchParams.get('scope')).toBe('openid profile email');
    expect(verifier).not.toBe(challenge);
  });

  it('the pending cookie round-trips and junk is refused', () => {
    const p = { state: 's', nonce: 'n', verifier: 'v', mode: 'connect' as const, redirect: '/x' };
    expect(decodePending(encodePending(p))).toEqual(p);
    expect(decodePending('junk')).toBeNull();
    expect(decodePending(undefined)).toBeNull();
  });

  it('a forged or missing state is refused', () => {
    expect(sameState('abc', 'abc')).toBe(true);
    expect(sameState('abc', 'abd')).toBe(false);
    expect(sameState('abc', undefined)).toBe(false);
  });

  it('an id_token with the wrong nonce is refused', () => {
    const jwt = (c: object) => ['h', Buffer.from(JSON.stringify(c)).toString('base64url'), 's'].join('.');
    const good = { iss: 'https://coinpayportal.com', aud: 'cp_x', sub: 's', nonce: 'n1', exp: Math.floor(Date.now() / 1000) + 60 };
    expect(checkIdToken({ idToken: jwt(good), clientId: 'cp_x', nonce: 'n1' }).sub).toBe('s');
    expect(() => checkIdToken({ idToken: jwt({ ...good, nonce: 'evil' }), clientId: 'cp_x', nonce: 'n1' })).toThrow();
  });

  it('derives the issuer from the configured authorize URL', () => {
    expect(coinpayIssuer('https://pay.example.com/api/oauth/authorize')).toBe('https://pay.example.com');
    expect(coinpayIssuer(undefined)).toBe('https://coinpayportal.com');
  });
});
