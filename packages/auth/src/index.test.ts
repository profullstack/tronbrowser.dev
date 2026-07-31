import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import {
  CoinPayOAuthProvider,
  resolveCoinPayConfig,
  generateCoinPayPkcePair,
  generateCoinPayState,
  COINPAY_DEFAULTS,
  isExpired,
} from './index.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('CoinPay OAuth', () => {
  it('defaults to the hosted coinpayportal endpoints and scopes', () => {
    const cfg = resolveCoinPayConfig({ clientId: 'abc', redirectUri: 'tronbrowser://cb' });
    expect(cfg.authorizeUrl).toBe(COINPAY_DEFAULTS.authorizeUrl);
    expect(cfg.authorizeUrl).toContain('coinpayportal.com/api/oauth/authorize');
    expect(cfg.scopes).toContain('wallet:read');
    expect(cfg.scopes).toContain('openid');
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
    expect(url.searchParams.get('scope')).toBe('openid profile email did wallet:read');
  });

  it('honors a self-hosted issuer when building the authorize URL', () => {
    const provider = new CoinPayOAuthProvider({
      clientId: 'abc',
      redirectUri: 'tronbrowser://cb',
      authorizeUrl: 'https://pay.example.com/api/oauth/authorize',
      tokenUrl: 'https://pay.example.com/api/oauth/token',
    });
    const url = new URL(provider.authorizeUrl('state123', 'challenge456'));
    expect(url.origin).toBe('https://pay.example.com');
    expect(url.pathname).toBe('/api/oauth/authorize');
  });

  it('generates a random state and a valid S256 PKCE pair', () => {
    const state = generateCoinPayState();
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateCoinPayState()).not.toBe(state);

    const { codeVerifier, codeChallenge } = generateCoinPayPkcePair();
    const expected = createHash('sha256')
      .update(codeVerifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(codeChallenge).toBe(expected);
  });

  it('exchanges an authorization code for tokens', async () => {
    const mockFetch = vi.fn(async () =>
      jsonResponse({
        access_token: 'at-123',
        refresh_token: 'rt-456',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile email did wallet:read',
      }),
    );
    const provider = new CoinPayOAuthProvider({
      clientId: 'abc',
      redirectUri: 'tronbrowser://cb',
      fetch: mockFetch,
    });

    const before = Math.floor(Date.now() / 1000);
    const tokens = await provider.exchangeCode('code-789', 'verifier-xyz');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(String(url)).toBe('https://coinpayportal.com/api/oauth/token');
    expect(init?.method).toBe('POST');
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-789');
    expect(body.get('client_id')).toBe('abc');
    expect(body.get('redirect_uri')).toBe('tronbrowser://cb');
    expect(body.get('code_verifier')).toBe('verifier-xyz');

    expect(tokens.accessToken).toBe('at-123');
    expect(tokens.refreshToken).toBe('rt-456');
    expect(tokens.tokenType).toBe('Bearer');
    expect(tokens.scope).toBe('openid profile email did wallet:read');
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600);
  });

  it('throws when the token exchange fails', async () => {
    const mockFetch = vi.fn(async () => jsonResponse({ error: 'invalid_grant' }, 400));
    const provider = new CoinPayOAuthProvider({
      clientId: 'abc',
      redirectUri: 'tronbrowser://cb',
      fetch: mockFetch,
    });
    await expect(provider.exchangeCode('bad-code', 'verifier')).rejects.toThrow(
      /token exchange failed \(400\)/,
    );
  });

  it('fetches userinfo claims with the access token', async () => {
    const mockFetch = vi.fn(async () =>
      jsonResponse({ sub: 'user-1', email: 'a@b.c', did: 'did:coinpay:user-1' }),
    );
    const provider = new CoinPayOAuthProvider({
      clientId: 'abc',
      redirectUri: 'tronbrowser://cb',
      fetch: mockFetch,
    });

    const claims = await provider.fetchUserinfo('at-123');
    expect(claims.sub).toBe('user-1');
    expect(claims.email).toBe('a@b.c');

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(String(url)).toBe('https://coinpayportal.com/api/oauth/userinfo');
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer at-123');
  });

  it('detects expiry with skew', () => {
    const tokens = { accessToken: 'x', expiresAt: 1000, tokenType: 'Bearer' };
    expect(isExpired(tokens, 980)).toBe(true); // within 30s skew
    expect(isExpired(tokens, 900)).toBe(false);
  });
});
