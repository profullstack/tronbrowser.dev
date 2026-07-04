/**
 * `tron mcp` — local MCP server over stdio (PRD M3.6). Built into the launcher
 * payload (sdk/mcp-bin.js) and run via tron-node.mjs so @tronbrowser/* resolve.
 */
import { createMcpServer } from './mcp/server.js';
import { serveStdio } from './mcp/server.js';
import { McpBrowserSession } from './mcp/session.js';

const argv = process.argv.slice(2);
const headless = argv.includes('--headless');
const profileIdx = argv.indexOf('--profile');
const profile = profileIdx >= 0 ? argv[profileIdx + 1] : undefined;

const session = McpBrowserSession.fromSdk({ headless, ...(profile ? { profile } : {}) });
const server = createMcpServer(session);

process.stderr.write('tron mcp: TronBrowser MCP server on stdio\n');

serveStdio(server, {
  input: process.stdin,
  write: (line) => process.stdout.write(line),
}).catch((err: unknown) => {
  process.stderr.write(`tron mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
