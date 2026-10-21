// The $1 pay-to-list fee, paid through a CoinPay hosted checkout session.
//
// We create a session (POST /api/checkout/sessions with the business API key)
// and send the publisher to its hosted page, where they pick any coin or PayPal.
// CoinPay then posts a signed webhook; a paid event marks our local
// extension_payments row paid (keyed on the session id stored as provider_ref).
// /confirm can also reconcile by reading the session back with the key.
import { CoinPay, verifyWebhook, readWebhook } from '@profullstack/coinpay-onboard';

export const LISTING_FEE_CENTS = 100; // $1.00
export const LISTING_FEE_CURRENCY = 'usd';
export const LISTING_PROPERTY = 'tronbrowser.dev';

function client(): CoinPay {
  const key = process.env.COINPAY_API_KEY;
  if (!key) throw new Error('COINPAY_API_KEY not configured');
  const base = process.env.COINPAY_API_URL;
  return new CoinPay(base ? { token: key, base } : { token: key });
}

export interface ListingCheckout {
  id: string;
  url: string;
  methods: string[];
}

/**
 * Create a CoinPay checkout session for the $1 listing fee. `paymentId` is our
 * extension_payments.id; it rides in metadata so the webhook can reconcile even
 * if provider_ref was never written.
 */
export async function createListingCheckout(opts: {
  extensionId: string;
  paymentId: string;
  slug: string;
  userId: string;
  email: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<ListingCheckout> {
  const s = await client().createCheckoutSession({
    amount: LISTING_FEE_CENTS / 100,
    currency: 'USD',
    description: `TronBrowser extension listing: ${opts.slug}`,
    customerEmail: opts.email,
    accountId: opts.userId,
    property: LISTING_PROPERTY,
    metadata: { extension_id: opts.extensionId, payment_id: opts.paymentId, slug: opts.slug },
    successUrl: opts.successUrl,
    cancelUrl: opts.cancelUrl,
    expiresInMinutes: 60,
  });
  return { id: s.id, url: s.url, methods: (s as any).methods ?? [] };
}

/** True when CoinPay reports the session as paid (read with the business key). */
export async function listingSessionPaid(sessionId: string): Promise<boolean> {
  if (!sessionId?.startsWith('cs_')) return false;
  try {
    const s: any = await client().checkoutSession(sessionId);
    return s?.status === 'paid';
  } catch {
    return false;
  }
}

export interface ListingWebhook {
  paid: boolean;
  type: string;
  sessionId: string | null;
  localPaymentId: string | null;
}

/**
 * Verify a CoinPay webhook (X-CoinPay-Signature over the RAW body with
 * COINPAY_WEBHOOK_SECRET) and read the nested payload. Returns null when the
 * signature is missing, wrong or stale.
 */
export function readListingWebhook(rawBody: string, sigHeader: string | undefined): ListingWebhook | null {
  const secret = process.env.COINPAY_WEBHOOK_SECRET;
  if (!secret || !sigHeader) return null;
  if (!verifyWebhook(rawBody, sigHeader, secret)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const ev = readWebhook(payload);
  const md = (ev.metadata ?? {}) as Record<string, unknown>;
  return {
    paid: ev.paid,
    type: ev.type,
    sessionId: ev.checkoutSessionId,
    localPaymentId: typeof md.payment_id === 'string' && md.payment_id ? md.payment_id : null,
  };
}
