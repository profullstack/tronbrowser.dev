/**
 * The crawl door: AI training crawlers, headless browsers and SEO scrapers buy a
 * day pass ($1 a day over x402, or any coin / PayPal through CoinPay's hosted
 * checkout) on /crawl, and get a 402 on the site's pages. People, verified search
 * crawlers, AI chat/search fetchers and signed-in users are never charged, and
 * the API and MCP relay are never metered. Built only with a scoped key and a
 * payee, so a local or self-hosted server never sells.
 *
 * Caddy serves the pages, so it asks here first: `forward_auth` sends every page
 * request to /api/crawl-gate with the original method and path in
 * X-Forwarded-Method / X-Forwarded-Uri. A 2xx lets Caddy serve the page; any
 * other answer (the 402 offer) is copied back to the client as it is.
 */
import { createGateway } from '@profullstack/x402-gateway';

export type CrawlGate = { handle: (request: Request) => Promise<Response | null> };

export function createCrawlGate(env: Record<string, string | undefined> = process.env): CrawlGate | null {
  const apiKey = env.COINPAY_X402_KEY ?? '';
  const payTo = env.CRAWL_PAY_TO ?? '';
  if (!apiKey || !payTo) return null;
  return createGateway({
    siteUrl: (env.APP_URL || 'https://tronbrowser.dev').replace(/\/+$/, ''),
    siteName: 'TronBrowser',
    coinpay: { apiKey },
    payTo,
    contact: 'mailto:anthony@profullstack.com',
    openPaths: ['/api/', '/mcp/', '/llms.txt', '/llms-full.txt', '/skill.md', '/install.sh'],
    exempt: (request: Request) => /(?:^|;\s*)tb_session=/.test(request.headers.get('cookie') ?? ''),
  });
}

/** The page request Caddy is asking about, rebuilt from its forward_auth headers. */
export function forwardedRequest(request: Request, origin: string): Request {
  const uri = request.headers.get('x-forwarded-uri') || '/';
  const method = (request.headers.get('x-forwarded-method') || 'GET').toUpperCase();
  const headers = new Headers(request.headers);
  for (const name of ['x-forwarded-uri', 'x-forwarded-method', 'x-forwarded-host', 'x-forwarded-proto', 'content-length']) {
    headers.delete(name);
  }
  return new Request(new URL(uri.startsWith('/') ? uri : '/', origin), { method: method === 'HEAD' ? 'HEAD' : 'GET', headers });
}

/** forward_auth answer: 204 to serve the page, or the gateway's own answer. */
export async function crawlCheck(gate: CrawlGate | null, request: Request, origin: string): Promise<Response> {
  if (!gate) return new Response(null, { status: 204 });
  return (await gate.handle(forwardedRequest(request, origin))) ?? new Response(null, { status: 204 });
}
