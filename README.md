# TronBrowser.dev

Open-source, privacy-first, AI-native browser built on a Chromium fork.

**Principles:** no telemetry by default · no ads · no sponsored tabs · no affiliate injection · user-owned data · Chrome compatibility · self-hostable.

See [`docs/tronbrowser-prd.md`](docs/tronbrowser-prd.md) for the full engineering PRD.

## Monorepo layout

| Path | Contents |
| --- | --- |
| `apps/` | `desktop`, `mobile`, `web`, `docs` |
| `packages/` | `ai-core`, `browser-core`, `workflow-engine`, `agent-runtime`, `model-providers`, `auth`, `sync`, `storage`, `sdk`, `plugins`, `ui`, `shared` |
| `services/` | `api`, `worker`, `scheduler`, `sync-server` |

Every package ships a `README.md` and (for shared libraries) tests.

## Requirements

- Node.js **24+**
- pnpm **9+**

## Getting started

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Milestones

| Milestone | Scope |
| --- | --- |
| **M0** | Monorepo scaffold ✅ |
| M1 | Chromium fork |
| M2 | AI sidebar |
| M3 | Browser agents |
| M4 | Cloud services |
| M5 | Mobile (React Native) |
| M6 | Plugins |
| M7 | Agent swarms |

## License

TBD (open-source).
