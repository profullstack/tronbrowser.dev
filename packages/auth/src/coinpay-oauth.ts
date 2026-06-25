/**
 * CoinPay OAuth provider. Lets a user sign into TronBrowser with their CoinPay
 * account so the browser can authorize x402 payments (see @tronbrowser/payments)
 * from their CoinPay global wallet addresses.
 *
 * Endpoints default to CoinPay's hosted service and are overridable for
 * self-hosted CoinPay deployments.
 */

import {
  isExpired,
  type OAuthConfig,
  type OAuthProvider,
  type OAuthTokens,
} from './oauth.js';

export const COINPAY_DEFAULTS = {
  authorizeUrl: 'https://coinpayportal.com/oauth/authorize',
  tokenUrl: 'https://coinpayportal.com/oauth/token',
  /** Scopes needed to read wallet addresses and authorize x402 payments. */
  scopes: ['wallet:read', 'payments:x402'],
} as const;

export interface CoinPayOAuthConfig {
  clientId: string;
  redirectUri: string;
  /** Override for self-hosted CoinPay; defaults to the hosted service. */
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
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

/**
 * CoinPay OAuth provider (Authorization Code + PKCE). Network calls are stubbed
 * until M2; URL construction is implemented and tested now.
 */
export class CoinPayOAuthProvider implements OAuthProvider {
  readonly config: OAuthConfig;

  constructor(config: CoinPayOAuthConfig) {
    this.config = resolveCoinPayConfig(config);
  }

  authorizeUrl(state: string, codeChallenge: string): string {
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async exchangeCode(_code: string, _codeVerifier: string): Promise<OAuthTokens> {
    throw new Error('CoinPayOAuthProvider.exchangeCode: not implemented (M2)');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async refresh(_refreshToken: string): Promise<OAuthTokens> {
    throw new Error('CoinPayOAuthProvider.refresh: not implemented (M2)');
  }
}

export { isExpired };
