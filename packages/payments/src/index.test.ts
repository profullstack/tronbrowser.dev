import { describe, it, expect } from 'vitest';
import {
  parsePaymentRequired,
  encodePaymentHeader,
  decodePaymentHeader,
  selectAddress,
  PaymentProcessor,
  type PaymentPayload,
  type CoinPayWallet,
  type CoinPayAddress,
} from './index.js';

const payload: PaymentPayload = {
  x402Version: 1,
  scheme: 'exact',
  network: 'base',
  payload: { signature: '0xabc' },
};

describe('x402 header codec', () => {
  it('round-trips the X-PAYMENT header', () => {
    const encoded = encodePaymentHeader(payload);
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(decodePaymentHeader(encoded)).toEqual(payload);
  });

  it('parses a 402 body and rejects malformed input', () => {
    const body = { x402Version: 1, accepts: [{ network: 'base' }] };
    expect(parsePaymentRequired(body).accepts).toHaveLength(1);
    expect(() => parsePaymentRequired({})).toThrow(/accepts/);
    expect(() => parsePaymentRequired(null)).toThrow();
  });
});

describe('CoinPay address selection', () => {
  const addrs: CoinPayAddress[] = [
    { network: 'base', address: '0xbase', assets: ['USDC', 'ETH'] },
    { network: 'polygon', address: '0xpoly', assets: ['USDC'] },
  ];

  it('matches on network + asset', () => {
    expect(selectAddress(addrs, { network: 'base', asset: 'USDC' })?.address).toBe('0xbase');
    expect(selectAddress(addrs, { network: 'polygon', asset: 'ETH' })).toBeUndefined();
  });
});

describe('PaymentProcessor', () => {
  const wallet: CoinPayWallet = {
    listAddresses: async () => [
      { network: 'base', address: '0xbase', assets: ['USDC'] },
    ],
    getBalance: async () => '1000000',
    authorize: async () => ({ payload, reference: 'cp_ref_1' }),
  };

  it('pays a satisfiable requirement and returns retry headers', async () => {
    const proc = new PaymentProcessor(wallet);
    const result = await proc.process({
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: 'base',
          maxAmountRequired: '1000',
          resource: 'https://x/y',
          payTo: '0xdest',
          asset: 'USDC',
        },
      ],
    });
    expect(result.headers['X-PAYMENT']).toBeDefined();
    expect(result.reference).toBe('cp_ref_1');
  });

  it('throws when no wallet/network/asset matches', async () => {
    const proc = new PaymentProcessor(wallet);
    await expect(
      proc.process({
        x402Version: 1,
        accepts: [
          {
            scheme: 'exact',
            network: 'solana',
            maxAmountRequired: '1000',
            resource: 'https://x/y',
            payTo: 'dest',
            asset: 'USDC',
          },
        ],
      }),
    ).rejects.toThrow(/no CoinPay wallet/);
  });

  it('respects the maxAmount guard', async () => {
    const proc = new PaymentProcessor(wallet);
    await expect(
      proc.process(
        {
          x402Version: 1,
          accepts: [
            {
              scheme: 'exact',
              network: 'base',
              maxAmountRequired: '5000',
              resource: 'https://x/y',
              payTo: '0xdest',
              asset: 'USDC',
            },
          ],
        },
        { maxAmount: 1000n },
      ),
    ).rejects.toThrow();
  });
});
