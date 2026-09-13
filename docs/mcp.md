# MCP server (M3.6) and `tron automate` (M3.8)

TronBrowser speaks the [Model Context Protocol](https://modelcontextprotocol.io)
two ways:

- `tron mcp` runs the browser + analyze tools over **stdio** for a local MCP
  host (Claude Desktop, IDE agents).
- `tron automate` adds an engine router: **Obscura first for scraping, the
  managed Chromium session as the fallback for full-JS pages**, over stdio or
  over HTTP with an [OpenMCP](https://logicsrc.com/openmcp) descriptor.

```sh
tron mcp                          # headed managed session, stdio
tron mcp --headless               # headless
tron mcp --profile work

tron automate                     # stdio MCP: fetch_page + engine_status + browser_*
tron automate serve               # same server over HTTP on 127.0.0.1:7333
tron automate fetch <url>         # one-shot: print the page as markdown
tron automate status              # which engines are usable
```

Both speak newline-delimited JSON-RPC 2.0 on stdin/stdout by default; only
`tron automate serve` opens a listener, and it binds loopback unless told
otherwise. The managed session launches lazily on the first tool that needs it
and is torn down on `browser_close` (or when the host disconnects).

## Example host config

```json
{
  "mcpServers": {
    "tronbrowser": { "command": "tron", "args": ["automate"] }
  }
}
```

## Tools

The router (both `tron mcp` and `tron automate`):

```
fetch_page      url, format=markdown|text|links|html, engine=auto|obscura|chromium,
                max_chars, timeout_s
engine_status   which engines are usable and whether they are running
```

Primitive browser tools (the managed Chromium session):

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
- `fetch_page` returns two text blocks: the page, then one JSON line
  `{"engine","url","format","ms","chars","fellBack"?}` saying which engine
  answered and why the fallback ran, when it did.
- `browser_screenshot` returns image content (PNG); `browser_extract`,
  `browser_analyze`, `browser_step`, `browser_run_task`, and `browser_tabs`
  return JSON text.
- `browser_analyze`/`step`/`run_task` are backed by the deterministic analyze
  engine (M3.5), so form-fill works without an AI provider; open-ended goals
  report `AI_PROVIDER_NOT_CONFIGURED`.

## How the router picks an engine

[Obscura](https://github.com/h4ckf0r0day/obscura) is a headless browser with
its own renderer and a real V8. Measured on the same pages, it renders a light
page in tens of milliseconds for about 30 MB, and Chromium cannot start in under
700 ms. On JS-heavy pages the order flips: a warm Chromium is 3 to 10 times
faster than Obscura, and only Chromium passes a real login or an interactive
bot wall. So `engine=auto`:

1. Asks Obscura (`browser_navigate` + `browser_markdown`, over stdio) with a
   budget of `timeout_s` (default 20 s).
2. Falls back to the managed Chromium session when Obscura is not installed,
   errors, runs out of budget, or hands back a page that is plainly a wall
   ("Just a moment", "enable JavaScript", "Access denied", a captcha) or empty.
3. `engine=obscura` never falls back and returns whatever Obscura saw;
   `engine=chromium` never asks Obscura.

`--stealth` runs Obscura with a Chrome TLS fingerprint and its tracker
blocklist. The Chromium fallback is headless by default for `tron automate`
(`--headed` shows it) and headed by default for `tron mcp` (`--headless`).

Obscura is two ~100 MB binaries, so the release tarball does not carry it: the
installer downloads the pinned release (0.2.2) next to the launcher, in
`obscura-bin/`, on install and on `tron upgrade`. Without it every fetch goes
through Chromium and `tron automate` says so once. `TB_NO_OBSCURA_INSTALL=1`
skips the download, `TRONBROWSER_OBSCURA_VERSION` pins another release, and
`curl -fsSL https://tronbrowser.dev/install.sh | sh -s -- ensure-obscura`
installs it on its own. `TRON_OBSCURA_BIN` or `OBSCURA_BIN` point the runtime at
any other binary.

## HTTP and OpenMCP

`tron automate serve` exposes the same server over Streamable HTTP, plain JSON
in and out, with the descriptor an OpenMCP catalog reads:

```
POST http://127.0.0.1:7333/mcp                       JSON-RPC (one message or a batch)
GET  http://127.0.0.1:7333/.well-known/openmcp.json  the OpenMCP descriptor
GET  http://127.0.0.1:7333/healthz
```

Register it on a catalog with `openmcp add http://127.0.0.1:7333`. A catalog
has to be able to reach the address, so a listing on a public catalog needs a
reachable host: `--host 0.0.0.0 --port 7333 --token <secret>` requires
`Authorization: Bearer <secret>` on `/mcp` and the descriptor says
`auth.kind: bearer`. The server refuses to bind a non-loopback host without a
token. `TRON_MCP_TOKEN` works in place of `--token`.

## Hosted relay: tronbrowser.dev/mcp/tron

The same router runs inside the tronbrowser.dev container as a public
[OpenMCP](https://logicsrc.com/openmcp) relay, so any agent can use the
ungoogled-chromium engine without installing anything:

```
POST https://tronbrowser.dev/mcp/tron                  JSON-RPC (Streamable HTTP, plain JSON)
GET  https://tronbrowser.dev/mcp/tron                  health + which engines are up
GET  https://tronbrowser.dev/.well-known/openmcp.json  the descriptor a catalog reads
```

It is keyless and stateless on purpose: only `fetch_page` and `screenshot_page`
(no click/fill/session tools), one fresh tab per call, closed afterwards, and
nothing kept between calls. Guards, all in `services/api/src/mcp`:

- Public targets only: `localhost`, `*.local`, `*.internal`, literal private
  addresses and any name that resolves to one are refused before an engine is
  asked; the Chromium engine also carries host-resolver rules for the same
  ranges and Obscura blocks private targets itself.
- 3 pages rendering at once (a fourth call gets `Busy`), 30 calls a minute per
  caller address (`Rate limited`), a 1 MiB request body, 400k characters and a
  45 s Obscura budget per fetch.

The container (`Dockerfile`) bakes in the portable ungoogled-chromium build
and Obscura, pinned by build args; Caddy proxies `/mcp/*` to the API next to
`/api/*`. `TRON_MCP_DISABLED=1` turns the relay off, `TRON_MCP_CHROMIUM_BIN` and
`OBSCURA_BIN` point at other binaries, `TRON_MCP_IDLE_MS` sets how long Chromium
stays up with nothing to do (default 5 min). Chromium starts on the first call
that needs it and costs a few hundred MB while up.

Listing it on the catalog is one registration (`openmcp add
https://tronbrowser.dev`, or `POST https://openmcp.logicsrc.com/v1/relays
{"url":"https://tronbrowser.dev"}`); the catalog reads the descriptor from this
origin, runs the handshake, and re-probes on its own schedule. Smoke-test a
build with `node services/api/scripts/mcp-smoke.mjs`.

## How it works

- The shell `tron` dispatcher runs `sdk/mcp-bin.js` or `sdk/automate-bin.js`
  via `tron-node.mjs` (which resolves the `@tronbrowser/*` imports) with
  `TRON_SESSION_BIN` set so the server can launch/close its managed session and
  `TRON_OBSCURA_BIN` pointing at the installed Obscura.
- The MCP protocol layer is a small, dependency-free JSON-RPC 2.0 server
  (`packages/sdk/src/mcp`) — no `@modelcontextprotocol/sdk` dependency, keeping
  the shipped runtime self-contained. Tools wrap the SDK `Browser`/`Page`;
  `mcp/obscura.ts` is the MCP client that drives Obscura as a child process;
  `mcp/automate.ts` is the router; `mcp/http.ts` is the HTTP transport and the
  descriptor.
- Obscura is driven over stdio on purpose: its own HTTP transport answers the
  first request on a connection quickly and then stalls every later request on
  that connection by about 4 seconds.

## Scope

- Requires Node ≥22.
- Cookies/local storage are not exposed as tools.
