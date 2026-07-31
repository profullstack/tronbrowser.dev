# SDK and `tron run` (M3.4)

Write browser automation as scripts with the public SDK, and run them with
`tron run` — no build step, no `node_modules` of your own.

```ts
import { tron } from '@tronbrowser/sdk';

const browser = await tron.launch({ headless: true });
const page = await browser.newPage();

await page.goto('https://example.com/contact');
const snap = await page.snapshot();
const emailRef = snap.elements.find((e) => e.name === 'Email')?.ref;
if (emailRef) await page.fill(emailRef, 'jane@example.com');

console.log(await page.extract('links'));
await page.screenshot({ fullPage: true }).then(/* … */);
await browser.close();
```

```sh
tron run ./agent.ts                 # TypeScript runs directly (Node ≥24 strips types)
tron run ./agent.js
tron run ./agent.ts --headless      # force headless regardless of launch({})
tron run ./agent.ts --profile work  # use a named profile
tron run ./agent.ts --trace ./trace # write an action trace bundle
```

## API (`@tronbrowser/sdk`)

- **`tron.launch(options?)` → `Browser`** — `{ headless?, profile? }`. Starts a
  managed session in its own isolated temp profile.
- **`Browser`**: `newPage()`, `pages()`, `close()` (stops the session, removes
  the temp profile).
- **`Page`**: `goto`, `reload`, `back`, `forward`, `snapshot`/`snapshotText`,
  `click(@ref)`, `fill(@ref, value)`, `type`, `extract(target, fields?)`,
  `screenshot`, `pdf`, `eval`, `url`, `title`, `close`.
- `analyze` / `step` / `runTask` are declared but land in **M3.5** (AI analyze).

## How `tron run` works

- The shell `tron` dispatcher runs `tron-run.mjs` via `node`, passing
  `TRON_SESSION_BIN` so the SDK can launch/close a managed session.
- `tron-run.mjs` registers an ESM resolver hook that maps `@tronbrowser/sdk`
  and `@tronbrowser/browser-core` to the runtime shipped in the launcher payload,
  then imports your script. TypeScript needs no build — Node ≥24 strips types.
- `--headless` / `--profile` / `--trace` arrive via env and are honored by
  `tron.launch()` when the script doesn't specify otherwise.

## Trace bundles (`--trace <dir>`)

A minimal trace (full trace/replay is M3.7): `metadata.json` plus
`actions.jsonl` — the sequence of page actions. **Values are redacted** (a
`fill` records its ref, never the text), matching the PRD's default privacy.

## Scope / limitations

- Requires Node ≥24 (bundled with the desktop app or on PATH).
- `click`/`fill` take `@refs` from a `snapshot`; richer targets (CSS/text/role)
  and character-level `type`/`press` come later.
- SDK contracts are unit-tested and exercised end-to-end over the real CDP
  transport in `packages/sdk/src/*.test.ts`.
