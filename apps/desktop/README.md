# @tronbrowser/desktop

Desktop shell for the TronBrowser Chromium fork — the isolated, desktop-specific
integration layer (PRD rule: *desktop-specific code stays isolated*).

> Milestone **M1 (Chromium fork)**: build pipeline + privacy-enforcing launch
> layer in place. The actual Chromium compile is large (~50GB checkout) and runs
> via guarded scripts, not in CI yet.

## Two halves

| Path | Responsibility |
| --- | --- |
| [`chromium/`](chromium/) | Fork the browser: pinned versions, GN build args, branding, patch series, fetch/build scripts. See [chromium/README](chromium/README.md). |
| [`src/`](src/) | Resolve the built binary and launch it with privacy flags enforced. |
| [`extensions/ai-sidebar/`](extensions/ai-sidebar/) | **M2** AI side panel (MV3 extension) — BYOK chat, bundled into the fork. |

## TypeScript API

```ts
import { launch, buildLaunchFlags } from '@tronbrowser/desktop';

// Privacy flags are applied by default; sponsored/affiliate flags are refused.
launch({ outDir: '/path/to/chromium/out/TronBrowser', urls: ['https://tronbrowser.dev'] });
```

## Scripts

- `pnpm build` / `pnpm typecheck` / `pnpm test`
- `pnpm chromium:fetch | sync | patch | build | package` — fork pipeline
  (each dry-runs unless `TB_RUN=1`).

See the [PRD](../../docs/tronbrowser-prd.md) and
[ADR 0001](../../docs/adr/0001-chromium-fork-base.md).
