# CLAUDE.md

You are building TronBrowser.dev from scratch.

Source of truth:
./docs/tronbrowser-prd.md

Default stack:
- pnpm workspace
- Node.js 24+
- TypeScript
- Chromium / Ungoogled Chromium fork
- React Native (Phase 2)
- Hono/Fastify
- Turso
- Redis/BullMQ
- Cloudflare R2
- Docker
- Railway

Rules:
- No telemetry by default
- No ads
- No sponsored tabs
- No affiliate injection
- Preserve Chrome extension compatibility
- Preserve bookmarks/profiles/history
- Build incrementally by phases
- Stub packages before implementation
- Add README.md to every package
- Add tests for shared libraries
- Prefer simple working code
