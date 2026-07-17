/**
 * CoinPay OAuth provider. Lets a user sign into TronBrowser with their CoinPay
 * account so the browser can authorize x402 payments (see @tronbrowser/payments)
 * from their CoinPay global wallet addresses.
 *
 * The OAuth2/OIDC legwork (state/PKCE generation, authorize-URL construction,
 * code exchange, userinfo fetch) is delegated to `@profullstack/stack/coinpay`;
 * this module keeps the @tronbrowser/auth-facing contracts (`OAuthProvider`,
 * `OAuthTokens`) and the tronbrowsers scopes.
 *
 * Endpoints default to CoinPay's hosted service and are overridable for
 * self-hosted CoinPay deployments.
 */

import {
  exchangeCoinPayCode,
  fetchCoinPayUserinfo,
  generateCoinPayPkcePair,
  generateCoinPayState,
  getCoinPayAuthorizeUrl,
  type CoinPayFetch,
  type CoinPayOAuthTokens,
  type CoinPayUserinfoClaims,
} from '@profullstack/stack/coinpay';

import {
  isExpired,
  type OAuthConfig,
  type OAuthProvider,
  type OAuthTokens,
} from './oauth.js';

export const COINPAY_DEFAULTS = {
  authorizeUrl: 'https://coinpayportal.com/api/oauth/authorize',
  tokenUrl: 'https://coinpayportal.com/api/oauth/token',
  /** Scopes needed to read wallet addresses and authorize x402 payments. */
  scopes: ['openid', 'profile', 'email', 'did', 'wallet:read'],
} as const;

export interface CoinPayOAuthConfig {
  clientId: string;
  redirectUri: string;
  /** Confidential-client secret; omit for public (PKCE-only) clients. */
  clientSecret?: string;
  /** Override for self-hosted CoinPay; defaults to the hosted service. */
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  /** Injectable fetch implementation (defaults to the global `fetch`). */
  fetch?: CoinPayFetch;
}

/** Resolves user-supplied config against CoinPay defaults. */
export function resolveCoinPayConfig(cfg: CoinPayOAuthConfig): OAuthConfig {
  return {
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    authorizeUrl: cfg.authorizeUrl ?? COINPAY_DEFAULTS.authorizeUrl,
    tokenUrl: cfg.tokenUrl ?? COINPAY_DEFAULTS.tokenUrl,
    scopes: cfg.scopes ?? [...COINPAY_DEFAULTS.scopes],
  };
}

const AUTHORIZE_SUFFIX = '/api/oauth/authorize';
const TOKEN_SUFFIX = '/api/oauth/token';

/**
 * Derives the issuer a `@profullstack/stack/coinpay` helper expects from an
 * endpoint URL with the standard CoinPay layout (`<issuer><suffix>`). Returns
 * `undefined` for non-standard endpoint URLs.
 */
function issuerFromEndpoint(url: string, suffix: string): string | undefined {
  return url.endsWith(suffix) ? url.slice(0, -suffix.length) : undefined;
}

/** Maps the CoinPay token response onto the shared `OAuthTokens` shape. */
function toOAuthTokens(tokens: CoinPayOAuthTokens): OAuthTokens {
  // CoinPay always returns expires_in; 3600 is the conventional fallback.
  const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600;
  return {
    accessToken: tokens.access_token,
    tokenType: tokens.token_type ?? 'Bearer',
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    ...(tokens.refresh_token !== undefined ? { refreshToken: tokens.refresh_token } : {}),
    ...(tokens.scope !== undefined ? { scope: tokens.scope } : {}),
  };
}

/**
 * CoinPay OAuth provider (Authorization Code + PKCE), built on the
 * `@profullstack/stack/coinpay` helpers.
 */
export class CoinPayOAuthProvider implements OAuthProvider {
  readonly config: OAuthConfig;

  readonly #clientSecret: string | undefined;
  readonly #fetch: CoinPayFetch | undefined;
  readonly #authorizeIssuer: string | undefined;
  readonly #tokenIssuer: string | undefined;

  constructor(config: CoinPayOAuthConfig) {
    this.config = resolveCoinPayConfig(config);
    if (config.clientSecret !== undefined) this.#clientSecret = config.clientSecret;
    if (config.fetch !== undefined) this.#fetch = config.fetch;
    this.#authorizeIssuer = issuerFromEndpoint(this.config.authorizeUrl, AUTHORIZE_SUFFIX);
    this.#tokenIssuer = issuerFromEndpoint(this.config.tokenUrl, TOKEN_SUFFIX);
  }

  authorizeUrl(state: string, codeChallenge: string): string {
    if (this.#authorizeIssuer !== undefined) {
      return getCoinPayAuthorizeUrl({
        clientId: this.config.clientId,
        redirectUri: this.config.redirectUri,
        state,
        codeChallenge,
        issuer: this.#authorizeIssuer,
        scopes: this.config.scopes,
      });
    }
    // Non-standard authorize endpoint override: build the query directly.
    const u = new URL(this.config.authorizeUrl);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', this.config.clientId);
    u.searchParams.set('redirect_uri', this.config.redirectUri);
    u.searchParams.set('scope', this.config.scopes.join(' '));
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return u.toString();
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
    const issuer = this.#tokenIssuer ?? this.#authorizeIssuer;
    const tokens = await exchangeCoinPayCode({
      code,
      redirectUri: this.config.redirectUri,
      clientId: this.config.clientId,
      clientSecret: this.#clientSecret ?? '',
      codeVerifier,
      ...(issuer !== undefined ? { issuer } : {}),
      ...(this.#fetch !== undefined ? { fetch: this.#fetch } : {}),
    });
    return toOAuthTokens(tokens);
  }

  /** Fetches the OIDC userinfo claims for an access token. */
  async fetchUserinfo(accessToken: string): Promise<CoinPayUserinfoClaims> {
    const issuer = this.#tokenIssuer ?? this.#authorizeIssuer;
    return fetchCoinPayUserinfo({
      accessToken,
      ...(issuer !== undefined ? { issuer } : {}),
      ...(this.#fetch !== undefined ? { fetch: this.#fetch } : {}),
    });
  }

  async refresh(_refreshToken: string): Promise<OAuthTokens> {
    throw new Error('CoinPayOAuthProvider.refresh: not implemented (M2)');
  }
}

export {
  generateCoinPayPkcePair,
  generateCoinPayState,
  isExpired,
  type CoinPayUserinfoClaims,
};
