import { describe, it, expect } from 'vitest';
import { extLoginTarget } from './ext-login.js';

const APP = 'https://tronbrowser.dev';
const CALLBACK = 'https://tronbrowser.dev/ext-callback.html?src=tb';

describe('extLoginTarget', () => {
  it('hands an existing website session straight to the extension', () => {
    expect(extLoginTarget(CALLBACK, APP, true)).toEqual({
      kind: 'session',
      redirect: CALLBACK,
    });
  });

  it('runs the CoinPay dance when not signed in, preserving the callback', () => {
    const t = extLoginTarget(CALLBACK, APP, false);
    expect(t.kind).toBe('oauth');
    if (t.kind !== 'oauth') throw new Error('expected oauth');
    expect(t.url).toBe(
      `/api/auth/coinpay/login?redirect=${encodeURIComponent(CALLBACK)}`,
    );
    // The nested redirect must survive one decode intact, or the second hop
    // loses the callback and we regress to the website-only login.
    const nested = new URL(t.url, APP).searchParams.get('redirect');
    expect(nested).toBe(CALLBACK);
  });

  it('accepts a site-relative callback', () => {
    expect(extLoginTarget('/ext-callback.html?src=tb', APP, true)).toEqual({
      kind: 'session',
      redirect: CALLBACK,
    });
  });

  it('rejects off-origin callbacks — including the chromiumapp.org URL that broke this', () => {
    expect(extLoginTarget('https://abc.chromiumapp.org/', APP, true).kind).toBe('reject');
    expect(extLoginTarget('https://evil.com/steal', APP, true).kind).toBe('reject');
    expect(extLoginTarget('//evil.com', APP, false).kind).toBe('reject');
  });

  it('rejects a missing callback rather than defaulting somewhere', () => {
    expect(extLoginTarget(undefined, APP, true).kind).toBe('reject');
    expect(extLoginTarget('', APP, false).kind).toBe('reject');
  });
});
