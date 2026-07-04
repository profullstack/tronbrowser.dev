# MCP server (M3.6)

`tron mcp` runs a local [Model Context Protocol](https://modelcontextprotocol.io)
server over **stdio**, exposing TronBrowser's browser + analyze tools to any MCP
host (Claude Desktop, IDE agents, etc.).

```sh
tron mcp                # headed managed session
tron mcp --headless     # headless
tron mcp --profile work
```

It speaks newline-delimited JSON-RPC 2.0 on stdin/stdout — **local only**, never
a network listener. The managed session launches lazily on the first tool call
and is torn down on `browser_close` (or when the host disconnects).

## Example host config

```json
{
  "mcpServers": {
    "tronbrowser": { "command": "tron", "args": ["mcp", "--headless"] }
  }
}
```

## Tools

Primitive browser tools:

```
browser_open      browser_snapshot   browser_click     browser_fill
browser_type      browser_press      browser_select    browser_scroll
browser_wait      browser_extract    browser_screenshot browser_tabs
browser_close
```

AI-assisted unknown-interface tools:

```
browser_analyze   # non-mutating: analyze the page / map a form to data (dry-run)
browser_step      # one validated action toward a goal
browser_run_task  # bounded unknown-interface task
```

- **Mutating tools return a fresh snapshot** (open/click/fill/type/press/select/
  scroll), so the host always sees current, ref-tagged page state.
- `browser_screenshot` returns image content (PNG); `browser_extract`,
  `browser_analyze`, `browser_step`, `browser_run_task`, and `browser_tabs`
  return JSON text.
- `browser_analyze`/`step`/`run_task` are backed by the deterministic analyze
  engine (M3.5), so form-fill works without an AI provider; open-ended goals
  report `AI_PROVIDER_NOT_CONFIGURED`.

## How it works

- The shell `tron` dispatcher runs `sdk/mcp-bin.js` via `tron-node.mjs` (which
  resolves the `@tronbrowser/*` imports) with `TRON_SESSION_BIN` set so the
  server can launch/close its managed session.
- The MCP protocol layer is a small, dependency-free JSON-RPC 2.0 server
  (`packages/sdk/src/mcp`) — no `@modelcontextprotocol/sdk` dependency, keeping
  the shipped runtime self-contained. Tools wrap the SDK `Browser`/`Page`.

## Scope

- Requires Node ≥22. Runs over stdio; remote transports are out of scope.
- Cookies/local storage are not exposed as tools.
