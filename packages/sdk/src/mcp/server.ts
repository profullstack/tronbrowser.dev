/**
 * Assemble the MCP server from a browser session, and a newline-delimited stdio
 * transport (PRD M3.6). Local only — the host speaks JSON-RPC over stdin/stdout.
 */
import { McpServer, type McpServerInfo } from './protocol.js';
import type { McpBrowserSession } from './session.js';
import { browserTools } from './tools.js';

const DEFAULT_INFO: McpServerInfo = { name: 'tronbrowser', version: '3.7' };

export function createMcpServer(session: McpBrowserSession, info: McpServerInfo = DEFAULT_INFO): McpServer {
  const server = new McpServer(info);
  for (const tool of browserTools(session)) server.register(tool);
  return server;
}

export interface StdioTransport {
  input: AsyncIterable<string | Uint8Array>;
  write(line: string): void;
}

/** Read newline-delimited JSON-RPC from input, write responses to output. */
export async function serveStdio(server: McpServer, io: StdioTransport): Promise<void> {
  let buffer = '';
  for await (const chunk of io.input) {
    buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // skip malformed lines
      }
      const response = await server.handle(msg as never);
      if (response) io.write(JSON.stringify(response) + '\n');
    }
  }
}
