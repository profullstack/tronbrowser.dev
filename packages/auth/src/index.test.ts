import { describe, it, expect } from 'vitest';
import {
  CoinPayOAuthProvider,
  resolveCoinPayConfig,
  COINPAY_DEFAULTS,
  isExpired,
} from './index.js';

describe('CoinPay OAuth', () => {
  it('defaults to the hosted CoinPay endpoints and x402 scopes', () => {
    const cfg = resolveCoinPayConfig({ clientId: 'abc', redirectUri: 'tronbrowser://cb' });
    expect(cfg.authorizeUrl).toBe(COINPAY_DEFAULTS.authorizeUrl);
    expect(cfg.scopes).toContain('payments:x402');
  });

  it('allows self-hosted CoinPay overrides', () => {
    const cfg = resolveCoinPayConfig({
      clientId: 'abc',
      redirectUri: 'tronbrowser://cb',
      authorizeUrl: 'https://pay.example.com/oauth/authorize',
    });
    expect(cfg.authorizeUrl).toBe('https://pay.example.com/oauth/authorize');
  });

  it('builds a PKCE authorize URL', () => {
    const provider = new CoinPayOAuthProvider({
      clientId: 'abc',
      redirectUri: 'tronbrowser://cb',
    });
    const url = new URL(provider.authorizeUrl('state123', 'challenge456'));
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('abc');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('state123');
  });

  it('detects expiry with skew', () => {
    const tokens = { accessToken: 'x', expiresAt: 1000, tokenType: 'Bearer' };
    expect(isExpired(tokens, 980)).toBe(true); // within 30s skew
    expect(isExpired(tokens, 900)).toBe(false);
  });
});
