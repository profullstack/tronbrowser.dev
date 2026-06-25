// The $1 pay-to-list fee. Two methods, both self-contained (no SDK deps — just
// fetch + node:crypto) so this builds inside the slim API Docker image:
//   - Stripe: Checkout Session + webhook signature verification (fully wired)
//   - CoinPay / x402: HTTP-402 challenge + a settlement confirm (verification
//     against CoinPay lands post-stub, matching @tronbrowser/payments' style)
import { createHmac, timingSafeEqual } from 'node:crypto';

export const LISTING_FEE_CENTS = 100; // $1.00
export const LISTING_FEE_CURRENCY = 'usd';

/* ---------------- Stripe ---------------- */

export interface StripeCheckout {
  id: string;
  url: string;
}

/**
 * Create a Stripe Checkout Session for the $1 listing fee. `clientReferenceId`
 * is our extension_payments.id so the webhook can reconcile.
 */
export async function createStripeCheckout(opts: {
  extensionId: string;
  paymentId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<StripeCheckout> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');

  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', opts.successUrl);
  form.set('cancel_url', opts.cancelUrl);
  form.set('client_reference_id', opts.paymentId);
  form.set('metadata[extension_id]', opts.extensionId);
  form.set('metadata[payment_id]', opts.paymentId);
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', LISTING_FEE_CURRENCY);
  form.set('line_items[0][price_data][unit_amount]', String(LISTING_FEE_CENTS));
  form.set('line_items[0][price_data][product_data][name]', 'TronBrowser extension listing');

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (!res.ok) throw new Error(`stripe checkout failed: ${res.status} ${await res.text()}`);
  const session: any = await res.json();
  return { id: session.id, url: session.url };
}

/**
 * Verify a Stripe webhook signature (the `Stripe-Signature` header) against the
 * raw request body and STRIPE_WEBHOOK_SECRET. Returns the parsed event, or null
 * if the signature is missing/invalid/stale. Implements Stripe's scheme without
 * the SDK: signed_payload = `${t}.${rawBody}`, HMAC-SHA256 with the secret.
 */
export function verifyStripeWebhook(rawBody: string, sigHeader: string | undefined, toleranceSec = 300): any | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !sigHeader) return null;

  const parts = Object.fromEntries(
    sigHeader.split(',').map((kv) => kv.split('=', 2) as [string, string]),
  );
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return null;

  // Reject stale timestamps (replay protection).
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > toleranceSec) return null;

  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

/* ---------------- CoinPay / x402 ---------------- */

export const X402_VERSION = 1 as const;

export interface X402PaymentRequirements {
  scheme: 'exact';
  network: string;
  asset: string;
  amount: string; // atomic units
  payTo: string;
  resource: string;
  description: string;
}

/**
 * Build the HTTP-402 challenge body for paying the listing fee with a CoinPay
 * global wallet (USDC). The client (or TronBrowser's built-in wallet) settles
 * it and re-requests with an X-PAYMENT header.
 */
export function listingPaymentRequirements(resource: string): { x402Version: number; accepts: X402PaymentRequirements[] } {
  const network = process.env.STORE_X402_NETWORK || 'base';
  const payTo = process.env.STORE_X402_PAY_TO || '';
  return {
    x402Version: X402_VERSION,
    accepts: [
      {
        scheme: 'exact',
        network,
        asset: 'USDC',
        amount: '1000000', // 1 USDC (6 decimals)
        payTo,
        resource,
        description: 'TronBrowser extension listing fee',
      },
    ],
  };
}

/**
 * Confirm a CoinPay/x402 settlement by reference. Real verification (querying
 * CoinPay's settlement API for the reference + amount) lands post-stub; for now
 * we accept a non-empty reference when STORE_X402_TRUST_CLIENT is set (dev), and
 * otherwise refuse so we never mark a listing paid without a real settlement.
 */
export async function confirmCoinPaySettlement(reference: string): Promise<boolean> {
  if (!reference) return false;
  if (process.env.STORE_X402_TRUST_CLIENT === '1') return true;
  const api = process.env.COINPAY_SETTLEMENT_URL;
  if (!api) return false;
  try {
    const r = await fetch(`${api.replace(/\/$/, '')}/${encodeURIComponent(reference)}`);
    if (!r.ok) return false;
    const s: any = await r.json();
    return s?.status === 'settled' || s?.status === 'paid';
  } catch {
    return false;
  }
}
