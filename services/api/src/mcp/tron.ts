/**
 * tronbrowser.dev/mcp/tron: the hosted OpenMCP relay. Obscura first for
 * scraping, the ungoogled-chromium engine as the fallback for full-JS pages,
 * the same `fetch_page` router `tron automate` runs locally, plus a
 * `screenshot_page`. Public and keyless, so it is stateless on purpose: every
 * call gets a fresh tab that is closed afterwards, nothing is remembered
 * between calls, targets are public hosts only, and callers are capped.
 *
 * The descriptor a catalog reads is the static /.well-known/openmcp.json on
 * this origin (served by Caddy), which is what makes the listing verified.
 */
import { Hono } from 'hono';
import {
  DirectChromium,
  fetchPage,
  McpBrowserSession,
  McpServer,
  ObscuraClient,
  parseFetchArgs,
  resolveChromiumBin,
  resolveObscuraBin,
  type FetchArgs,
  type FetchOutcome,
  type JsonRpcMessage,
  type McpContent,
} from '@tronbrowser/sdk';
import { acceptableUrl, clientKey, RateLimiter, type Lookup } from './guard.js';

export const DESCRIPTOR_URL = 'https://tronbrowser.dev/.well-known/openmcp.json';
export const MAX_CONCURRENT = 3;
export const RATE_BURST = 20;
export const RATE_PER_MINUTE = 30;
export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_CHARS_CAP = 400_000;
export const MAX_TIMEOUT_S = 45;

export interface Fetched {
  text: string;
  outcome: FetchOutcome;
}

/** The engine side, injectable so the route is testable without a browser. */
export interface TronRelayDeps {
  fetch?: (args: FetchArgs) => Promise<Fetched>;
  screenshot?: (url: string) => Promise<Uint8Array>;
  lookup?: Lookup;
  now?: () => number;
  maxConcurrent?: number;
  rate?: { burst: number; perMinute: number };
  log?: (line: string) => void;
}

export interface TronRelay {
  app: Hono;
  server: McpServer;
  /** Engines in use, when the real ones were built. */
  engines?: { obscura: ObscuraClient; chromium: DirectChromium };
  close(): Promise<void>;
}

/** Real engines: Obscura on stdio, one Chromium shared across calls, one fresh tab per call. */
export function realEngines(log: (line: string) => void = () => {}) {
  const obscuraBin = process.env.OBSCURA_BIN ?? resolveObscuraBin();
  const obscura = new ObscuraClient({ bin: obscuraBin, stealth: process.env.TRON_MCP_STEALTH === '1' });
  const chromium = new DirectChromium({
    bin: process.env.TRON_MCP_CHROMIUM_BIN ?? resolveChromiumBin(),
    headless: true,
    blockPrivate: true,
    noSandbox: process.getuid?.() === 0 || process.env.TRON_MCP_NO_SANDBOX === '1',
    idleMs: Number(process.env.TRON_MCP_IDLE_MS ?? 5 * 60_000),
    log,
  });
  const fetch = async (args: FetchArgs): Promise<Fetched> => {
    // A session per call: the router opens a tab only if Obscura is not enough.
    const session = new McpBrowserSession(() => chromium.page());
    try {
      return await fetchPage({ obscura, session }, args);
    } finally {
      await session.close().catch(() => {});
    }
  };
  const screenshot = async (url: string): Promise<Uint8Array> => {
    const tab = await chromium.page();
    try {
      await tab.page.goto(url);
      return await tab.page.screenshot();
    } finally {
      await tab.close().catch(() => {});
    }
  };
  return { obscura, chromium, fetch, screenshot };
}

const text = (t: string): McpContent => ({ type: 'text', text: t });
const toolError = (message: string) => ({ content: [text(message)], isError: true });

export function tronRelay(deps: TronRelayDeps = {}): TronRelay {
  const log = deps.log ?? ((line: string) => console.log(`[mcp/tron] ${line}`));
  const engines = deps.fetch && deps.screenshot ? undefined : realEngines(log);
  const doFetch = deps.fetch ?? (engines as NonNullable<typeof engines>).fetch;
  const doShot = deps.screenshot ?? (engines as NonNullable<typeof engines>).screenshot;
  const lookup = deps.lookup;
  const maxConcurrent = deps.maxConcurrent ?? MAX_CONCURRENT;
  const limiter = new RateLimiter({ burst: deps.rate?.burst ?? RATE_BURST, perMinute: deps.rate?.perMinute ?? RATE_PER_MINUTE, ...(deps.now ? { now: deps.now } : {}) });
  let inFlight = 0;

  // Throws so the MCP layer answers isError; a public relay never queues.
  async function guarded<T>(work: () => Promise<T>): Promise<T> {
    if (inFlight >= maxConcurrent) throw new Error(`Busy: ${maxConcurrent} pages are rendering. Try again in a moment.`);
    inFlight++;
    try {
      return await work();
    } finally {
      inFlight--;
    }
  }

  const server = new McpServer({ name: 'tronbrowser', version: '3.9' });
  server.register({
    name: 'fetch_page',
    description:
      'Fetch a public web page as markdown, text, links or html. Obscura renders first (fast, light); the ungoogled-chromium engine takes over for JS-heavy pages and bot walls. engine=obscura|chromium pins one. Keyless; a few fetches at a time.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Public http(s) URL' },
        format: { type: 'string', enum: ['markdown', 'text', 'links', 'html'], description: 'Default markdown' },
        engine: { type: 'string', enum: ['auto', 'obscura', 'chromium'], description: 'Default auto' },
        max_chars: { type: 'integer', minimum: 1000, description: `Cut the answer here. Default 200000, max ${MAX_CHARS_CAP}.` },
        timeout_s: { type: 'number', description: `Seconds Obscura gets before Chromium takes over. Default 20, max ${MAX_TIMEOUT_S}.` },
      },
      required: ['url'],
      additionalProperties: false,
    },
    handler: async (a) => {
      const verdict = await acceptableUrl(a.url, lookup);
      if (!verdict.ok) throw new Error(verdict.error);
      const args = parseFetchArgs({ ...a, url: verdict.url });
      args.maxChars = Math.min(args.maxChars, MAX_CHARS_CAP);
      args.budgetMs = Math.min(args.budgetMs, MAX_TIMEOUT_S * 1000);
      const r = await guarded(() => doFetch(args));
      log(`fetch ${r.outcome.engine} ${r.outcome.ms}ms ${r.outcome.chars}c ${args.url}${r.outcome.fellBack ? ` (${r.outcome.fellBack})` : ''}`);
      return [text(r.text), text(JSON.stringify(r.outcome))];
    },
  });
  server.register({
    name: 'screenshot_page',
    description: 'Render a public web page in the ungoogled-chromium engine and return a PNG of the viewport (1280x900).',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Public http(s) URL' } },
      required: ['url'],
      additionalProperties: false,
    },
    handler: async (a) => {
      const verdict = await acceptableUrl(a.url, lookup);
      if (!verdict.ok) throw new Error(verdict.error);
      const started = Date.now();
      const r = await guarded(() => doShot(verdict.url));
      log(`screenshot chromium ${Date.now() - started}ms ${verdict.url}`);
      return [{ type: 'image', data: Buffer.from(r).toString('base64'), mimeType: 'image/png' }];
    },
  });

  const app = new Hono();
  const toolNames = server.tools().map((t) => t.name);

  app.get('/', (c) =>
    c.json({
      ok: true,
      name: 'TronBrowser',
      // Railway terminates TLS, so the origin seen here is http://; report what the caller used.
      mcp: `${(c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.replace(':', '')).split(',')[0]}://${new URL(c.req.url).host}/mcp/tron`,
      descriptor: DESCRIPTOR_URL,
      tools: toolNames,
      engines: engines
        ? { obscura: engines.obscura.available(), chromium: engines.chromium.available(), chromiumRunning: engines.chromium.running() }
        : undefined,
    }),
  );

  app.post('/', async (c) => {
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > MAX_BODY_BYTES) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'body too large' } }, 413);
    const raw = await c.req.text();
    if (raw.length > MAX_BODY_BYTES) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'body too large' } }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, 400);
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    const key = clientKey(c.req.raw.headers);
    const responses: JsonRpcMessage[] = [];
    for (const msg of messages) {
      if (typeof msg !== 'object' || msg === null) {
        responses.push({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } } as unknown as JsonRpcMessage);
        continue;
      }
      const m = msg as JsonRpcMessage;
      if (m.method === 'tools/call' && m.id !== undefined && !limiter.take(key)) {
        responses.push({ jsonrpc: '2.0', id: m.id, result: toolError(`Rate limited: ${RATE_PER_MINUTE} calls a minute per caller. Slow down.`) });
        continue;
      }
      const reply = await server.handle(m);
      if (reply) responses.push(reply);
    }
    if (responses.length === 0) return c.body(null, 202);
    return c.json(Array.isArray(parsed) ? responses : responses[0]);
  });

  return {
    app,
    server,
    ...(engines ? { engines: { obscura: engines.obscura, chromium: engines.chromium } } : {}),
    async close() {
      if (engines) await Promise.allSettled([engines.obscura.close(), engines.chromium.close()]);
    },
  };
}
