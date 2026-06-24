/**
 * CoinPay wallet integration for x402.
 *
 * The user authenticates with CoinPay (OAuth — see `@tronbrowser/auth`) and
 * TronBrowser holds a short-lived access token. CoinPay exposes the user's
 * "global wallet addresses" (one or more per network) and authorizes payments
 * against them. Keys stay custodial in CoinPay; TronBrowser never sees them.
 */

import type { PaymentRequirements, PaymentPayload } from './x402.js';

/** Minimal token source; satisfied by `@tronbrowser/auth` without coupling. */
export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

/** One of the user's CoinPay global wallet addresses. */
export interface CoinPayAddress {
  /** Network id matching x402 PaymentRequirements.network. */
  network: string;
  address: string;
  /** Asset symbols this address can spend, e.g. ["USDC", "ETH"]. */
  assets: string[];
}

/** Result of asking CoinPay to authorize a payment for an x402 requirement. */
export interface CoinPayAuthorization {
  payload: PaymentPayload;
  /** CoinPay's internal reference for the authorization. */
  reference: string;
}

/** Client over the CoinPay wallet API. Implementation lands post-stub. */
export interface CoinPayWallet {
  /** Lists the user's global wallet addresses across networks. */
  listAddresses(): Promise<CoinPayAddress[]>;
  /** Atomic-unit balance of `asset` on `network`. */
  getBalance(network: string, asset: string): Promise<string>;
  /** Asks CoinPay to sign/authorize a payment satisfying `req`. */
  authorize(req: PaymentRequirements, from: CoinPayAddress): Promise<CoinPayAuthorization>;
}

/**
 * Picks the user's wallet address that can satisfy a payment requirement
 * (matching network + asset). Returns undefined when none qualifies. Pure.
 */
export function selectAddress(
  addresses: CoinPayAddress[],
  req: Pick<PaymentRequirements, 'network' | 'asset'>,
): CoinPayAddress | undefined {
  return addresses.find(
    (a) => a.network === req.network && a.assets.includes(req.asset),
  );
}
