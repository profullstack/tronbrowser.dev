/**
 * Minimal Model Context Protocol server core (PRD M3.6). Dependency-free:
 * implements the JSON-RPC 2.0 methods an MCP host needs (initialize, tools/list,
 * tools/call, ping) so the shipped runtime stays self-contained. Transport-
 * agnostic — `handle()` maps a parsed message to a response (or null for
 * notifications); `mcp-bin` wires it to newline-delimited stdio.
 */

export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler(args: Record<string, unknown>): Promise<McpContent[]>;
}

export interface McpServerInfo {
  name: string;
  version: string;
}

const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

function ok(id: number | string, result: unknown): JsonRpcMessage {
  return { jsonrpc: '2.0', id, result };
}
function fail(id: number | string, code: number, message: string): JsonRpcMessage {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export class McpServer {
  readonly #info: McpServerInfo;
  readonly #tools = new Map<string, McpTool>();

  constructor(info: McpServerInfo) {
    this.#info = info;
  }

  register(tool: McpTool): void {
    this.#tools.set(tool.name, tool);
  }

  tools(): McpTool[] {
    return [...this.#tools.values()];
  }

  /** Handle one JSON-RPC message; returns a response, or null for notifications. */
  async handle(msg: JsonRpcMessage): Promise<JsonRpcMessage | null> {
    // Notifications have no id and expect no response.
    if (msg.id === undefined) return null;
    const id = msg.id;

    switch (msg.method) {
      case 'initialize': {
        const requested = (msg.params?.protocolVersion as string | undefined) ?? DEFAULT_PROTOCOL_VERSION;
        return ok(id, {
          protocolVersion: requested,
          capabilities: { tools: { listChanged: false } },
          serverInfo: this.#info,
        });
      }
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, {
          tools: this.tools().map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });
      case 'tools/call': {
        const name = msg.params?.name as string | undefined;
        const args = (msg.params?.arguments as Record<string, unknown> | undefined) ?? {};
        const tool = name ? this.#tools.get(name) : undefined;
        if (!tool) {
          return ok(id, { content: [{ type: 'text', text: `Unknown tool: ${name ?? '(none)'}` }], isError: true });
        }
        try {
          return ok(id, { content: await tool.handler(args) });
        } catch (err) {
          return ok(id, {
            content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          });
        }
      }
      default:
        return fail(id, -32601, `Method not found: ${msg.method ?? '(none)'}`);
    }
  }
}
