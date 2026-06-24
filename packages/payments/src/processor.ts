/**
 * PaymentProcessor — ties x402 and CoinPay together.
 *
 * Given a 402 response, it selects a CoinPay wallet address, asks CoinPay to
 * authorize payment, and returns the headers to retry the original request with.
 * Spending controls (budgets/ledger) are layered on top by the agent runtime.
 */

import {
  parsePaymentRequired,
  encodePaymentHeader,
  PAYMENT_HEADER,
  type PaymentRequirements,
} from './x402.js';
import { selectAddress, type CoinPayWallet } from './coinpay.js';

export interface ProcessResult {
  /** Headers to merge into the retried request. */
  headers: Record<string, string>;
  /** The requirement that was paid. */
  requirement: PaymentRequirements;
  reference: string;
}

export interface ProcessOptions {
  /** Refuse to pay more than this (atomic units) per request. Optional guard. */
  maxAmount?: bigint;
}

/** Orchestrates one x402 payment against the user's CoinPay wallet. */
export class PaymentProcessor {
  constructor(private readonly wallet: CoinPayWallet) {}

  /** Handles a 402 body and returns retry headers, or throws if unpayable. */
  async process(body: unknown, opts: ProcessOptions = {}): Promise<ProcessResult> {
    const required = parsePaymentRequired(body);
    const addresses = await this.wallet.listAddresses();

    for (const req of required.accepts) {
      const from = selectAddress(addresses, req);
      if (!from) continue;

      if (opts.maxAmount !== undefined && BigInt(req.maxAmountRequired) > opts.maxAmount) {
        continue;
      }

      const auth = await this.wallet.authorize(req, from);
      return {
        headers: { [PAYMENT_HEADER]: encodePaymentHeader(auth.payload) },
        requirement: req,
        reference: auth.reference,
      };
    }

    throw new Error(
      'x402: no CoinPay wallet address satisfies the payment requirements (network/asset/amount)',
    );
  }
}
