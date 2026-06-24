# TronBrowser.dev - Engineering PRD (v2)

## Vision
TronBrowser is an open-source, privacy-first, AI-native browser built on a Chromium fork.

### Principles
- No telemetry by default
- No ads
- No sponsored tabs
- No affiliate injection
- User-owned data
- Chrome compatibility
- Self-hostable services

# Goals
1. Desktop Chromium browser
2. React Native mobile (Phase 2)
3. Cloud agents
4. Plugin ecosystem
5. Multi-agent platform

# Stack
- pnpm workspaces
- Node.js 24+
- TypeScript
- Chromium / Ungoogled Chromium
- React Native
- Hono/Fastify
- Turso
- Redis/BullMQ
- Cloudflare R2
- Docker
- Railway

# Monorepo

apps/
- desktop
- mobile
- web
- docs

packages/
- ai-core
- browser-core
- workflow-engine
- agent-runtime
- model-providers
- auth
- sync
- storage
- sdk
- plugins
- ui
- shared

services/
- api
- worker
- scheduler
- sync-server

# Desktop Requirements

Must preserve:
- Chrome extensions
- Profiles
- Bookmarks
- Downloads
- History
- PWAs
- DevTools

Replace:
- Branding
- Telemetry
- Sponsored integrations

# AI

Providers:
- OpenAI
- Anthropic
- Google
- OpenRouter
- Ollama
- LM Studio
- vLLM

Execution:
- Local
- Cloud
- Hybrid

# Agent Runtime

Components:
- Planner
- Executor
- Validator
- Memory
- Tool Registry
- Workflow Runner

# Workflow Engine

Node types:
- Prompt
- Browser
- AI
- HTTP
- Conditional
- Delay
- Export

# Plugin SDK

Lifecycle:
- install
- enable
- disable
- update
- uninstall

# Sync

Objects:
- bookmarks
- prompts
- workflows
- settings
- profiles

# Mobile (Phase 2)

React Native:
- Android
- iOS

Features:
- AI chat
- Sync
- Voice
- Push notifications
- Agent dashboard

# CI/CD

GitHub Actions:
- lint
- typecheck
- test
- build
- package
- release

# Claude Code Rules

- Stub all packages first.
- Define interfaces before implementations.
- Keep shared logic in packages.
- Desktop-specific code stays isolated.
- Add README and tests to every package.
- Use strict TypeScript.
- Prefer composition.
- Document architecture decisions.

# Milestones

M0 Monorepo
M1 Chromium fork
M2 AI sidebar
M3 Browser agents
M4 Cloud services
M5 Mobile
M6 Plugins
M7 Agent swarms
