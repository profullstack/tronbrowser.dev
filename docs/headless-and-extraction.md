# Headless and extraction (M3.3)

## One-shot headless

`tron headless <url>` launches a **headless, ephemeral** managed session,
navigates to the URL, performs one operation, and tears everything down
(profile included) — ideal for CI and agents.

```sh
tron headless https://example.com --snapshot            # structured snapshot (--json)
tron headless https://example.com --screenshot out.png  # PNG (--full-page)
tron headless https://example.com --pdf out.pdf         # PDF
tron headless https://example.com --extract links       # extraction JSON
```

It uses its own isolated data dir (a temp `TRONBROWSER_DATA`), so it never
touches an interactive `tron browser` session you may have running, and no
persistent profile is used.

## Extraction

`tron extract` reads structured data from the managed session's current page as
deterministic JSON (relative `href`/`src` resolved to absolute):

```sh
tron extract text        # main text content
tron extract links       # [{ text, href }]
tron extract forms       # [{ name, action, method, fields: [{ name, type, label, required, value }] }]
tron extract tables      # [{ headers, rows }]
tron extract main        # { text } of <main>/<article>

# Custom selector + fields (name=selector[@attr]); @href/@src come back absolute:
tron extract '.product-card' \
  --field title='.title' \
  --field price='.price' \
  --field url='a@href'
```

Password field values are never included. `forms` omits hidden inputs.

## Screenshots and PDF

```sh
tron screenshot page.png            # viewport PNG of the current page
tron screenshot page.png --full-page
tron pdf page.pdf                    # headless only
```

## How it works

- `extract`, `screenshot`, `pdf`, and `headless` are Node subcommands the shell
  `tron` dispatcher delegates to (see [snapshots-and-refs.md](./snapshots-and-refs.md)).
- Extraction runs one in-page script via CDP `Runtime.evaluate`; capture uses
  `Page.captureScreenshot` / `Page.printToPDF`.
- `headless` orchestrates in Node: it shells out to the `tron-session` engine
  (`TRON_SESSION_BIN`) to launch/close a headless session, then drives
  navigate + op over CDP, and always cleans up (even on failure).

## Scope / limitations

- Requires Node.js (>= 22). PDF requires headless.
- macOS headless is limited by the detached-launch model (see
  [managed-sessions.md](./managed-sessions.md)); Linux native/flatpak is primary.
- Contracts + DOM logic unit-tested in `packages/browser-core`
  (`automation/extract-script`, `capture`, `automate-*.test.ts`), plus an
  end-to-end run over the real HTTP+WebSocket transport.
