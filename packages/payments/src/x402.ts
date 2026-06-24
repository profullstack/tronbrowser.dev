/**
 * x402 (HTTP 402 "Payment Required") protocol primitives.
 *
 * Flow: a server replies `402` with a JSON body listing acceptable payment
 * requirements. The client builds a signed payment payload, base64-encodes it
 * into the `X-PAYMENT` request header, and retries. A facilitator (here, CoinPay)
 * verifies and settles. See https://x402.org and the Coinbase x402 spec.
 */

export const X402_VERSION = 1 as const;
export const PAYMENT_HEADER = 'X-PAYMENT' as const;
export const PAYMENT_RESPONSE_HEADER = 'X-PAYMENT-RESPONSE' as const;

/** A single way a resource will accept payment (one entry of `accepts`). */
export interface PaymentRequirements {
  /** Payment scheme, e.g. "exact". */
  scheme: string;
  /** Chain/network id, e.g. "base", "base-sepolia", "polygon". */
  network: string;
  /** Largest amount required, in the asset's atomic units (string for precision). */
  maxAmountRequired: string;
  /** The protected resource URL. */
  resource: string;
  description?: string;
  /** Address that receives the payment. */
  payTo: string;
  /** Asset contract address (or symbol for native). */
  asset: string;
  maxTimeoutSeconds?: number;
  /** Scheme-specific extra data. */
  extra?: Record<string, unknown>;
}

/** Parsed body of a 402 response. */
export interface PaymentRequiredBody {
  x402Version: number;
  accepts: PaymentRequirements[];
  error?: string;
}

/** Signed payment the client returns in the X-PAYMENT header. */
export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  /** Scheme payload (e.g. an EIP-3009 signed authorization). */
  payload: Record<string, unknown>;
}

/** Parses a 402 response body, throwing on malformed input. */
export function parsePaymentRequired(body: unknown): PaymentRequiredBody {
  if (typeof body !== 'object' || body === null) {
    throw new Error('x402: response body is not an object');
  }
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b['accepts'])) {
    throw new Error('x402: missing "accepts" array');
  }
  return {
    x402Version: typeof b['x402Version'] === 'number' ? b['x402Version'] : X402_VERSION,
    accepts: b['accepts'] as PaymentRequirements[],
    ...(typeof b['error'] === 'string' ? { error: b['error'] } : {}),
  };
}

/** Encodes a payment payload into the base64 X-PAYMENT header value. */
export function encodePaymentHeader(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/** Decodes an X-PAYMENT header value back into a payload. */
export function decodePaymentHeader(value: string): PaymentPayload {
  const json = Buffer.from(value, 'base64').toString('utf8');
  return JSON.parse(json) as PaymentPayload;
}
