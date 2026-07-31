# Snapshots and refs (M3.2)

Once a managed session is running (`tron browser launch`, see
[managed-sessions.md](./managed-sessions.md)), the `tron` CLI can read the
current page as a compact, ref-tagged structure and act on it by ref.

```sh
tron snapshot                 # compact text snapshot of the current page
tron snapshot --json          # machine-readable snapshot
tron snapshot --include-hidden
tron click @e3                # click a ref from the last snapshot
tron fill @e4 "hi@example.com" # fill an input/textarea by ref
```

Text output:

```txt
Page: Contact Us
URL: https://example.com/contact

@e1 heading "Contact Us"
@e2 textbox "Name"
@e3 textbox "Email"
@e4 link "Privacy" -> https://example.com/privacy
@e5 button "Submit"
```

## Refs

A snapshot assigns `@e1`, `@e2`, … to visible interactive elements (and
headings) in document order and tags each element in the page with a
`data-tron-ref` attribute. Because the ref lives in the DOM, a later
`tron click @e3` — a separate process — resolves it with a plain attribute
selector. If the element is gone (navigation, re-render), the action returns a
recoverable **STALE_REF** error (exit code 5) telling you to re-`snapshot`,
rather than acting on the wrong node. Prefer refs over CSS selectors for agents.

Password values are never echoed in snapshots; `--json` includes `role`,
`name`, `value`, `href`, visibility, and interactivity per element.

## How it works

- `snapshot`/`click`/`fill` are Node subcommands the shell `tron` dispatcher
  delegates to. They attach to the session's current page via the descriptor's
  `webSocketDebuggerUrl` and drive it over the Chrome DevTools Protocol
  (`Runtime.evaluate`).
- The CDP client uses Node's global `WebSocket` (Node >= 22) — no dependency.
  The runtime is `@tronbrowser/browser-core`'s compiled tree, shipped in the
  launcher payload; the dispatcher runs it with `node`.
- Everything stays on `127.0.0.1` — no page content leaves the machine.

## Scope / limitations

- Requires Node.js (>= 22) on PATH, plus a running managed session.
- The snapshot targets the session's current tab (`tron browser use <id>` to
  switch). Shadow DOM and cross-origin iframes are out of scope for M3.2.
- Contracts and CDP/DOM logic are unit-tested in
  `packages/browser-core/src/automation` and `src/automate-*.test.ts`.
