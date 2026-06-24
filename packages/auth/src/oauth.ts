/**
 * Generic OAuth 2.0 (Authorization Code + PKCE) contracts shared by providers.
 */

export interface OAuthConfig {
  clientId: string;
  /** Where the provider redirects after consent. */
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Unix seconds at which accessToken expires. */
  expiresAt: number;
  tokenType: string;
  scope?: string;
}

/** Authorization-code provider with PKCE. */
export interface OAuthProvider {
  /** Builds the URL to send the user to for consent. */
  authorizeUrl(state: string, codeChallenge: string): string;
  /** Exchanges an authorization code for tokens. */
  exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens>;
  /** Refreshes an expired access token. */
  refresh(refreshToken: string): Promise<OAuthTokens>;
}

/** True when the token is expired or within `skewSeconds` of expiring. */
export function isExpired(tokens: OAuthTokens, nowSeconds: number, skewSeconds = 30): boolean {
  return nowSeconds >= tokens.expiresAt - skewSeconds;
}
