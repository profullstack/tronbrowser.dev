/**
 * `tron automate` (PRD M3.8). Obscura for scraping, the managed Chromium
 * session for full-JS pages, one MCP server either way. Built into the
 * launcher payload (sdk/automate-bin.js) and run via tron-node.mjs.
 *
 *   tron automate                    MCP server over stdio (browser_* + fetch_page)
 *   tron automate serve              same server over HTTP with an OpenMCP descriptor
 *   tron automate fetch <url>        one-shot fetch, prints the page
 *   tron automate status             which engines are usable
 *
 * Common flags: --engine auto|obscura|chromium, --stealth, --headed,
 * --profile <name>, --obscura-bin <path>, --chromium-bin <path> (drive a
 * Chromium binary directly instead of the TronBrowser managed session).
 * serve: --host, --port, --token.
 * fetch: --format markdown|text|links|html, --max-chars N, --timeout S, --json.
 */
import { automateTools, engineStatus, fetchPage, parseFetchArgs, type AutomateDeps } from './mcp/automate.js';
import { DirectChromium, resolveChromiumBin } from './mcp/chromium.js';
import { DEFAULT_HTTP_PORT, serveHttp, WELL_KNOWN_PATH } from './mcp/http.js';
import { ObscuraClient, resolveObscuraBin } from './mcp/obscura.js';
import { createMcpServer, serveStdio } from './mcp/server.js';
import { McpBrowserSession } from './mcp/session.js';

interface Flags {
  positional: string[];
  values: Map<string, string>;
  switches: Set<string>;
}

const VALUE_FLAGS = new Set(['engine', 'profile', 'obscura-bin', 'chromium-bin', 'host', 'port', 'token', 'format', 'max-chars', 'timeout']);

function parseFlags(argv: string[]): Flags {
  const out: Flags = { positional: [], values: new Map(), switches: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (!arg.startsWith('--')) {
      out.positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
    if (VALUE_FLAGS.has(name)) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined) fail(`--${name} needs a value`);
      out.values.set(name, value);
    } else {
      out.switches.add(name);
    }
  }
  return out;
}

function fail(message: string, code = 2): never {
  process.stderr.write(`tron automate: ${message}\n`);
  process.exit(code);
}

function usage(): void {
  process.stdout.write(`tron automate — Obscura for scraping, Chromium for full-JS pages, one MCP server

Usage:
  tron automate                      MCP server over stdio (for Claude Desktop, IDE agents)
  tron automate serve                HTTP MCP server + OpenMCP descriptor (loopback, port ${DEFAULT_HTTP_PORT})
  tron automate fetch <url>          Print a page as markdown (--format text|links|html)
  tron automate status               Which engines are usable (--json)

Flags:
  --engine auto|obscura|chromium     Default auto: Obscura first, Chromium when it fails or hits a wall
  --stealth                          Obscura with a Chrome TLS fingerprint + tracker blocking
  --headed                           Show the Chromium fallback (headless by default)
  --profile <name>                   Chromium profile for the fallback session
  --obscura-bin <path>               Obscura binary (default: the installed one, or PATH)
  --chromium-bin <path>              Drive this Chromium directly (default: the TronBrowser managed session)
  serve: --host <h> --port <p> --token <t>   Bind address, port, and a required bearer token
  fetch: --format <f> --max-chars <n> --timeout <s> --json
`);
}

function deps(flags: Flags): AutomateDeps & { chromium?: DirectChromium; close(): Promise<void> } {
  const stealth = flags.switches.has('stealth');
  const bin = flags.values.get('obscura-bin') ?? resolveObscuraBin();
  const obscura = new ObscuraClient({ ...(bin ? { bin } : {}), stealth });
  const profile = flags.values.get('profile');
  const headless = !flags.switches.has('headed');
  // The managed TronBrowser session when the launcher is around; a Chromium
  // binary driven directly when asked for, or when there is no launcher at all.
  const chromiumBin = flags.values.get('chromium-bin') ?? process.env.TRON_CHROMIUM_BIN ?? (process.env.TRON_SESSION_BIN ? undefined : resolveChromiumBin());
  const chromium = chromiumBin ? new DirectChromium({ bin: chromiumBin, headless, noSandbox: process.getuid?.() === 0, log: (l) => process.stderr.write(`tron automate: ${l}\n`) }) : undefined;
  const session = chromium ? chromium.session() : McpBrowserSession.fromSdk({ headless, ...(profile ? { profile } : {}) });
  return {
    obscura,
    session,
    ...(chromium ? { chromium } : {}),
    async close() {
      await Promise.allSettled([obscura.close(), session.close()]);
      await chromium?.close();
    },
  };
}

function server(d: AutomateDeps) {
  return createMcpServer(d.session, { name: 'tronbrowser', version: '3.9' }, automateTools(d));
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const command = flags.positional[0] ?? 'mcp';
  if (flags.switches.has('help') || command === 'help') return usage();
  const engineFlag = flags.values.get('engine');
  if (engineFlag && !['auto', 'obscura', 'chromium'].includes(engineFlag)) fail('--engine must be auto|obscura|chromium');

  switch (command) {
    case 'mcp': {
      const d = deps(flags);
      process.stderr.write('tron automate: MCP server on stdio (Obscura + Chromium)\n');
      await serveStdio(server(d), { input: process.stdin, write: (line) => process.stdout.write(line) });
      await d.close();
      return;
    }
    case 'serve': {
      const d = deps(flags);
      const port = Number(flags.values.get('port') ?? DEFAULT_HTTP_PORT);
      if (!Number.isInteger(port) || port < 0 || port > 65535) fail('--port must be 0-65535');
      const host = flags.values.get('host') ?? '127.0.0.1';
      const token = flags.values.get('token') ?? process.env.TRON_MCP_TOKEN;
      if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1' && !token) {
        fail(`--host ${host} is reachable from other machines; pass --token (or TRON_MCP_TOKEN) to require a bearer token`);
      }
      const handle = await serveHttp(server(d), { host, port, ...(token ? { token } : {}), log: (l) => process.stderr.write(l + '\n') });
      process.stderr.write(
        `tron automate: MCP over HTTP at ${handle.url}/mcp\n` +
          `  descriptor  ${handle.url}${WELL_KNOWN_PATH}\n` +
          `  register    openmcp add ${handle.url}   (a catalog must be able to reach this address)\n` +
          (token ? '  auth        Authorization: Bearer <token>\n' : '  auth        none (loopback only)\n'),
      );
      const stop = async () => {
        await handle.close();
        await d.close();
        process.exit(0);
      };
      process.once('SIGINT', () => void stop());
      process.once('SIGTERM', () => void stop());
      return;
    }
    case 'fetch': {
      const url = flags.positional[1];
      if (!url) fail('usage: tron automate fetch <url> [--format markdown|text|links|html] [--engine auto|obscura|chromium]');
      const d = deps(flags);
      try {
        const timeout = flags.values.get('timeout');
        const maxChars = flags.values.get('max-chars');
        const args = parseFetchArgs({
          url,
          format: flags.values.get('format') ?? 'markdown',
          engine: engineFlag ?? 'auto',
          ...(maxChars ? { max_chars: Number(maxChars) } : {}),
          ...(timeout ? { timeout_s: Number(timeout) } : {}),
        });
        const { text, outcome } = await fetchPage(d, args);
        if (flags.switches.has('json')) process.stdout.write(JSON.stringify({ ...outcome, text }) + '\n');
        else {
          process.stdout.write(text.endsWith('\n') ? text : text + '\n');
          process.stderr.write(`[${outcome.engine} ${outcome.ms}ms ${outcome.chars} chars${outcome.fellBack ? `; ${outcome.fellBack}` : ''}]\n`);
        }
      } finally {
        await d.close();
      }
      return;
    }
    case 'status': {
      const d = deps(flags);
      const status = await engineStatus(d);
      if (flags.switches.has('json')) process.stdout.write(JSON.stringify(status) + '\n');
      else {
        const o = status.obscura;
        process.stdout.write(
          `obscura   ${o.available ? `ok  ${o.version ?? '?'}  ${o.bin ?? ''}` : 'missing (run: tron upgrade, or set TRON_OBSCURA_BIN)'}\n` +
            `chromium  ${d.chromium ? `ok  direct  ${d.chromium.bin ?? ''}` : process.env.TRON_SESSION_BIN ? 'ok  managed session via tron-session' : 'missing (no tron-session and no Chromium on PATH; set TRON_CHROMIUM_BIN)'}\n`,
        );
      }
      await d.close();
      return;
    }
    default:
      usage();
      fail(`unknown command: ${command}`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`tron automate: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
