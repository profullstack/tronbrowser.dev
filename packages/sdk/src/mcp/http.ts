/**
 * Streamable-HTTP transport for the MCP server, plus the OpenMCP descriptor
 * (PRD M3.8). `tron automate serve` binds it on loopback so an MCP host, or an
 * OpenMCP catalog, can reach the same tools `tron mcp` serves over stdio.
 *
 * Plain JSON in, plain JSON out: every POST /mcp carries one JSON-RPC message
 * (or a batch) and gets its response in the body, notifications get 202. That
 * is the subset OpenMCP's probe and every host we know of speak. No session
 * ids, no SSE, no dependency.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { JsonRpcMessage, McpServer } from './protocol.js';

export const OPENMCP_VERSION = '0.1';
export const WELL_KNOWN_PATH = '/.well-known/openmcp.json';
export const DEFAULT_HTTP_PORT = 7333;
const MAX_BODY_BYTES = 16 * 1024 * 1024;

/** What the server says about itself at /.well-known/openmcp.json. */
export interface OpenMcpDescriptor {
  openmcp: string;
  mcp: string;
  name: string;
  description: string;
  url: string;
  auth: { kind: 'none' | 'bearer'; open?: string[] };
  tags: string[];
  operator?: string;
  tools: string[];
}

export interface DescriptorOptions {
  /** The origin the server is reachable at, e.g. http://127.0.0.1:7333 */
  base: string;
  tools: string[];
  /** Set when POST /mcp needs `Authorization: Bearer`. */
  bearer?: boolean;
  operator?: string;
}

export const DEFAULT_OPERATOR = 'https://logicsrc.com/.well-known/openprofile.md';

export function openMcpDescriptor(options: DescriptorOptions): OpenMcpDescriptor {
  const base = options.base.replace(/\/+$/, '');
  return {
    openmcp: OPENMCP_VERSION,
    mcp: `${base}/mcp`,
    name: 'TronBrowser',
    description:
      'Browse and scrape from a local TronBrowser: fetch_page renders pages with Obscura and falls back to a managed Chromium session for JS-heavy pages, bot walls and logins; browser_* tools drive that session by ref (snapshot, click, fill, extract, screenshot).',
    url: 'https://tronbrowser.dev',
    auth: options.bearer ? { kind: 'bearer' } : { kind: 'none', open: options.tools },
    tags: ['browser', 'fetch', 'scrape', 'automation', 'chromium', 'obscura', 'local'],
    operator: options.operator ?? DEFAULT_OPERATOR,
    tools: options.tools,
  };
}

export interface HttpOptions {
  host?: string;
  port?: number;
  /** When set, POST /mcp requires `Authorization: Bearer <token>`. */
  token?: string;
  operator?: string;
  log?: (line: string) => void;
}

export interface HttpHandle {
  url: string;
  host: string;
  port: number;
  server: Server;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, accept, authorization, mcp-protocol-version, mcp-session-id',
    ...extra,
  });
  res.end(text);
}

const rpcError = (id: number | string | null, code: number, message: string): JsonRpcMessage =>
  ({ jsonrpc: '2.0', id: id ?? undefined, error: { code, message } }) as JsonRpcMessage;

/** Build the request handler; exported so tests can drive it without a socket. */
export function httpHandler(server: McpServer, options: HttpOptions, base: () => string) {
  const descriptor = () =>
    openMcpDescriptor({
      base: base(),
      tools: server.tools().map((t) => t.name),
      bearer: Boolean(options.token),
      ...(options.operator ? { operator: options.operator } : {}),
    });

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (req.method === 'OPTIONS') return send(res, 204, undefined);
    if (req.method === 'GET' && path === WELL_KNOWN_PATH) return send(res, 200, descriptor());
    if (req.method === 'GET' && (path === '/healthz' || path === '/')) {
      return send(res, 200, { ok: true, name: 'tronbrowser', mcp: `${base()}/mcp`, descriptor: `${base()}${WELL_KNOWN_PATH}` });
    }
    if (path !== '/mcp') return send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'POST /mcp' }, { allow: 'POST, OPTIONS' });
    if (options.token) {
      const auth = req.headers.authorization ?? '';
      if (auth !== `Bearer ${options.token}`) return send(res, 401, rpcError(null, -32001, 'bearer token required'));
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch (err) {
      return send(res, 413, rpcError(null, -32600, err instanceof Error ? err.message : 'bad body'));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return send(res, 400, rpcError(null, -32700, 'parse error'));
    }

    const messages = Array.isArray(parsed) ? parsed : [parsed];
    const responses: JsonRpcMessage[] = [];
    for (const msg of messages) {
      if (typeof msg !== 'object' || msg === null) {
        responses.push(rpcError(null, -32600, 'invalid request'));
        continue;
      }
      const reply = await server.handle(msg as JsonRpcMessage);
      if (reply) responses.push(reply);
    }
    if (responses.length === 0) return send(res, 202, undefined);
    return send(res, 200, Array.isArray(parsed) ? responses : responses[0]);
  };
}

/** Listen and resolve with the URL. Loopback unless told otherwise. */
export function serveHttp(server: McpServer, options: HttpOptions = {}): Promise<HttpHandle> {
  const host = options.host ?? '127.0.0.1';
  let url = '';
  const handler = httpHandler(server, options, () => url);
  const http = createServer((req, res) => {
    handler(req, res).catch((err: unknown) => {
      options.log?.(`tron automate: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) send(res, 500, rpcError(null, -32603, 'internal error'));
      else res.end();
    });
  });
  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port ?? DEFAULT_HTTP_PORT, host, () => {
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : (options.port ?? DEFAULT_HTTP_PORT);
      const shown = host.includes(':') ? `[${host}]` : host;
      url = `http://${shown}:${port}`;
      resolve({
        url,
        host,
        port,
        server: http,
        close: () =>
          new Promise<void>((done) => {
            http.close(() => done());
            http.closeAllConnections?.();
          }),
      });
    });
  });
}
