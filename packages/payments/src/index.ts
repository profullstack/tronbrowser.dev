/**
 * @tronbrowser/payments
 * x402 payment processing over the user's CoinPay global wallet addresses.
 *
 * - x402.ts     — HTTP 402 protocol primitives (parse/encode payment headers)
 * - coinpay.ts  — CoinPay wallet contract + address selection
 * - processor.ts — orchestrates one payment end to end
 */

export const PACKAGE_NAME = '@tronbrowser/payments' as const;

export * from './x402.js';
export * from './coinpay.js';
export * from './processor.js';
