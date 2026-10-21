import { describe, expect, it } from 'vitest';
import { crawlCheck, createCrawlGate } from './crawl-gate.js';

const GPT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)';
const CHROME = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  accept: 'text/html',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-dest': 'document',
};
const ORIGIN = 'https://tronbrowser.dev';
const gate = createCrawlGate({ COINPAY_X402_KEY: 'cp_live_test', CRAWL_PAY_TO: '0xCC3b072391AE7A8d10cF00DdC5F61DB2cA5541E5' })!;
const check = (uri: string, headers: Record<string, string>) =>
  crawlCheck(gate, new Request('http://localhost:8090/api/crawl-gate', { headers: { ...headers, 'x-forwarded-uri': uri, 'x-forwarded-method': 'GET' } }), ORIGIN);

describe('crawl gate', () => {
  it('is off without a key, and then lets every page through', async () => {
    expect(createCrawlGate({})).toBeNull();
    expect((await crawlCheck(null, new Request('http://localhost/api/crawl-gate'), ORIGIN)).status).toBe(204);
  });
  it('answers Caddy with a 402 offer for GPTBot', async () => {
    const res = await check('/', { 'user-agent': GPT });
    expect(res.status).toBe(402);
    expect(res.headers.get('payment-required')).toBeTruthy();
  });
  it('sells a $1 day pass on /crawl', async () => {
    const res = (await gate.handle(new Request(`${ORIGIN}/crawl`, { headers: { accept: 'application/json' } })))!;
    expect(res.status).toBe(402);
    expect(String(((await res.json()) as { accepts: Array<{ amount: string }> }).accepts[0]!.amount)).toBe('1000000');
  });
  it('lets browsers, signed-in users and the API through', async () => {
    expect((await check('/', CHROME)).status).toBe(204);
    expect((await check('/', { 'user-agent': GPT, cookie: 'tb_session=x' })).status).toBe(204);
    expect((await check('/api/healthz', { 'user-agent': GPT })).status).toBe(204);
  });
});
