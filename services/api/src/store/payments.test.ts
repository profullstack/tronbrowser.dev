import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyStripeWebhook, listingPaymentRequirements, LISTING_FEE_CENTS } from './payments.js';

function sign(body: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

describe('verifyStripeWebhook', () => {
  const secret = 'whsec_test_123';
  beforeEach(() => { process.env.STRIPE_WEBHOOK_SECRET = secret; });
  afterEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET; });

  it('accepts a valid signature and parses the event', () => {
    const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } });
    const event = verifyStripeWebhook(body, sign(body, secret));
    expect(event?.type).toBe('checkout.session.completed');
    expect(event?.data?.object?.id).toBe('cs_1');
  });

  it('rejects a tampered body', () => {
    const body = JSON.stringify({ type: 'a' });
    const header = sign(body, secret);
    expect(verifyStripeWebhook(body + 'x', header)).toBeNull();
  });

  it('rejects a wrong secret', () => {
    const body = '{}';
    expect(verifyStripeWebhook(body, sign(body, 'whsec_other'))).toBeNull();
  });

  it('rejects a stale timestamp', () => {
    const body = '{}';
    const old = Math.floor(Date.now() / 1000) - 10_000;
    expect(verifyStripeWebhook(body, sign(body, secret, old))).toBeNull();
  });

  it('rejects when secret or header missing', () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(verifyStripeWebhook('{}', 't=1,v1=abc')).toBeNull();
  });
});

describe('listingPaymentRequirements', () => {
  it('returns a $1 USDC x402 challenge', () => {
    const r = listingPaymentRequirements('https://tronbrowser.dev/x');
    expect(r.x402Version).toBe(1);
    expect(r.accepts[0].asset).toBe('USDC');
    expect(r.accepts[0].amount).toBe('1000000');
    expect(LISTING_FEE_CENTS).toBe(100);
  });
});
