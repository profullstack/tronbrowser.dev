import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signWebhook } from '@profullstack/coinpay-onboard';

// In-memory stand-ins for the Postgres-backed store db, so the routes run end to end.
const state = vi.hoisted(() => ({
  payments: new Map<string, { id: string; extension_id: string; status: string; provider_ref: string | null }>(),
  ext: { id: 'ext-1', slug: 'acme-dark', owner_user_id: 'user-1', status: 'draft' } as any,
  published: [] as string[],
}));

vi.mock('../db.js', () => ({
  userBySession: vi.fn(async (s: string) => (s === 'good' ? { id: 'user-1', email: 'owner@example.com' } : null)),
}));

vi.mock('./db.js', () => {
  const fn = (impl: any) => vi.fn(impl);
  return {
    extensionById: fn(async (id: string) => (id === state.ext.id ? state.ext : null)),
    latestVersion: fn(async () => ({ id: 'v1', version: '1.0.0' })),
    hasPaidListing: fn(async (extId: string) => [...state.payments.values()].some((p) => p.extension_id === extId && p.status === 'paid')),
    createPayment: fn(async (p: any) => {
      const id = `pay-${state.payments.size + 1}`;
      state.payments.set(id, { id, extension_id: p.extensionId, status: 'pending', provider_ref: null });
      return id;
    }),
    setPaymentRef: fn(async (id: string, ref: string) => { state.payments.get(id)!.provider_ref = ref; }),
    markPaidByRef: fn(async (ref: string) => {
      const p = [...state.payments.values()].find((x) => x.provider_ref === ref && x.status !== 'paid');
      if (!p) return null;
      p.status = 'paid';
      return p.extension_id;
    }),
    markPaidById: fn(async (id: string, ref: string) => {
      const p = state.payments.get(id);
      if (!p || p.status === 'paid' || (p.provider_ref && p.provider_ref !== ref)) return null;
      p.status = 'paid'; p.provider_ref = ref;
      return p.extension_id;
    }),
    setExtensionStatus: fn(async (id: string, s: string) => { state.published.push(id); state.ext.status = s; }),
  };
});
vi.mock('./mirror.js', () => ({ mirrorListing: vi.fn(async () => {}) }));
vi.mock('./vu1nz.js', () => ({ enqueueScan: vi.fn(async () => {}) }));

const { store } = await import('./routes.js');
const { readListingWebhook, LISTING_FEE_CENTS } = await import('./payments.js');

const SECRET = 'whsec_test_123';
const fetchMock = vi.fn();

function event(type: string, data: Record<string, unknown>) {
  return JSON.stringify({ id: `evt_${Math.random()}`, type, business_id: 'biz', data });
}
function postWebhook(body: string, sig = signWebhook(body, SECRET)) {
  return store.request('/payments/coinpay/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-coinpay-signature': sig }, body,
  });
}
async function startCheckout() {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
    success: true, id: 'cs_abc', url: 'https://coinpayportal.com/checkout/cs_abc', status: 'open', methods: ['BTC', 'USDC_POL', 'PAYPAL'],
  }), { status: 201 }));
  return store.request('/extensions/ext-1/checkout', {
    method: 'POST', headers: { authorization: 'Bearer good', 'content-type': 'application/json' }, body: JSON.stringify({ method: 'stripe' }),
  });
}

beforeEach(() => {
  state.payments.clear(); state.published = []; state.ext.status = 'draft';
  process.env.COINPAY_API_KEY = 'cp_live_test';
  process.env.COINPAY_WEBHOOK_SECRET = SECRET;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.COINPAY_API_KEY;
  delete process.env.COINPAY_WEBHOOK_SECRET;
});

describe('POST /extensions/:id/checkout', () => {
  it('creates a CoinPay checkout session with the owner, property and metadata', async () => {
    const res = await startCheckout();
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.checkoutUrl).toBe('https://coinpayportal.com/checkout/cs_abc');
    expect(body.method).toBe('coinpay');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://coinpayportal.com/api/checkout/sessions');
    expect(init.headers.authorization).toBe('Bearer cp_live_test');
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({
      amount: LISTING_FEE_CENTS / 100, currency: 'USD', customer_email: 'owner@example.com', account_id: 'user-1',
      property: 'tronbrowser.dev', metadata: { extension_id: 'ext-1', payment_id: 'pay-1', slug: 'acme-dark' },
      success_url: 'https://tronbrowser.dev/store/extension.html?slug=acme-dark&paid=1',
      cancel_url: 'https://tronbrowser.dev/store/extension.html?slug=acme-dark&canceled=1',
    });
    expect(sent.payment_method).toBeUndefined();
    expect(state.payments.get('pay-1')!.provider_ref).toBe('cs_abc');
  });

  it('needs a signed-in owner', async () => {
    const res = await store.request('/extensions/ext-1/checkout', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('answers 502 when CoinPay is not configured', async () => {
    delete process.env.COINPAY_API_KEY;
    const res = await store.request('/extensions/ext-1/checkout', { method: 'POST', headers: { authorization: 'Bearer good' } });
    expect(res.status).toBe(502);
  });
});

describe('POST /payments/coinpay/webhook', () => {
  it('settles on a nested payment.confirmed and publishes once (idempotent with forwarded)', async () => {
    await startCheckout();
    const data = { payment_id: 'p1', status: 'confirmed', amount_usd: 1, checkout_session_id: 'cs_abc', metadata: { payment_id: 'pay-1', extension_id: 'ext-1' } };
    expect((await postWebhook(event('payment.confirmed', data))).status).toBe(200);
    expect(state.payments.get('pay-1')!.status).toBe('paid');
    expect(state.published).toEqual(['ext-1']);

    expect((await postWebhook(event('payment.forwarded', { ...data, status: 'forwarded' }))).status).toBe(200);
    expect(state.published).toEqual(['ext-1']);
  });

  it('settles a PayPal capture (confirmed, status completed)', async () => {
    await startCheckout();
    await postWebhook(event('payment.confirmed', { payment_id: 'pp1', status: 'completed', rail: 'paypal', checkout_session_id: 'cs_abc', metadata: { payment_id: 'pay-1' } }));
    expect(state.payments.get('pay-1')!.status).toBe('paid');
  });

  it('settles on forwarded alone', async () => {
    await startCheckout();
    await postWebhook(event('payment.forwarded', { payment_id: 'p1', status: 'forwarded', checkout_session_id: 'cs_abc' }));
    expect(state.payments.get('pay-1')!.status).toBe('paid');
  });

  it('falls back to metadata.payment_id when provider_ref was never stored', async () => {
    await startCheckout();
    state.payments.get('pay-1')!.provider_ref = null;
    await postWebhook(event('payment.confirmed', { payment_id: 'p1', status: 'confirmed', checkout_session_id: 'cs_abc', metadata: { payment_id: 'pay-1' } }));
    expect(state.payments.get('pay-1')).toMatchObject({ status: 'paid', provider_ref: 'cs_abc' });
  });

  it('grants nothing for payment.expired', async () => {
    await startCheckout();
    const res = await postWebhook(event('payment.expired', { payment_id: 'p1', status: 'expired', checkout_session_id: 'cs_abc', metadata: { payment_id: 'pay-1' } }));
    expect(res.status).toBe(200);
    expect(state.payments.get('pay-1')!.status).toBe('pending');
    expect(state.published).toEqual([]);
  });

  it('rejects a bad signature with 401', async () => {
    await startCheckout();
    const body = event('payment.confirmed', { status: 'confirmed', checkout_session_id: 'cs_abc' });
    expect((await postWebhook(body, signWebhook(body, 'wrong'))).status).toBe(401);
    expect((await postWebhook(body + ' ', signWebhook(body, SECRET))).status).toBe(401);
    expect((await postWebhook(body, '')).status).toBe(401);
    expect(state.payments.get('pay-1')!.status).toBe('pending');
  });
});

describe('POST /extensions/:id/confirm', () => {
  it('reads the session back with the key and settles when paid', async () => {
    await startCheckout();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, session: { id: 'cs_abc', status: 'paid' } })));
    const res = await store.request('/extensions/ext-1/confirm', {
      method: 'POST', headers: { authorization: 'Bearer good', 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'cs_abc' }),
    });
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[1][0]).toBe('https://coinpayportal.com/api/checkout/sessions/cs_abc');
    expect(state.payments.get('pay-1')!.status).toBe('paid');
  });

  it('answers 402 while the session is open', async () => {
    await startCheckout();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, session: { id: 'cs_abc', status: 'open' } })));
    const res = await store.request('/extensions/ext-1/confirm', {
      method: 'POST', headers: { authorization: 'Bearer good', 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'cs_abc' }),
    });
    expect(res.status).toBe(402);
    expect(state.payments.get('pay-1')!.status).toBe('pending');
  });
});

describe('readListingWebhook', () => {
  it('returns null without a configured secret', () => {
    delete process.env.COINPAY_WEBHOOK_SECRET;
    const body = event('payment.confirmed', {});
    expect(readListingWebhook(body, signWebhook(body, SECRET))).toBeNull();
  });
});
