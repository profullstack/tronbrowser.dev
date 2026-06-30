# TronBrowser.dev

Open-source, **privacy-first, AI-native** web browser — de-googled, built on
**Ungoogled Chromium**.

**Principles:** no telemetry by default · no ads · no sponsored tabs · no
affiliate injection · user-owned data · Chrome-extension compatible · self-hostable.

[Website](https://tronbrowser.dev) · [Releases](https://github.com/profullstack/tronbrowser.dev/releases) · [PRD](docs/tronbrowser-prd.md) · [Distribution](distribution/README.md)

---

## Install

```bash
curl -fsSL https://tronbrowser.dev/install.sh | sh
```

Then use the agent-friendly **`tron`** CLI:

```bash
tron <url>        # open URL(s) in TronBrowser
tron --tor [url]  # route through Tor (hides your IP, reaches .onion) — see note
tron upgrade      # update to the latest release (no-ops if current)
tron remove       # uninstall (keeps your profile)
tron version
```

> **`--tor` is a convenience feature, not anonymity.** It hides your IP and lets
> you reach `.onion` sites from your everyday browser, using a separate wiped
> profile. It is **not** Tor-Browser-grade: Chromium's fingerprinting surface
> isn't hardened. **If your safety depends on it, use the real
> [Tor Browser](https://www.torproject.org/) — it's much safer.** Requires the
> `tor` daemon installed. Details: [`docs/tor-onion-mode.md`](docs/tor-onion-mode.md).

Also packaged for **macOS · Windows · Debian/Ubuntu (.deb) · Fedora/RHEL (.rpm) ·
Arch (AUR) · Gentoo · NixOS · Snap · Flatpak · AppImage · FreeBSD** — and arm64
Linux phones (Librem 5 / PinePhone / Ubuntu Touch). See
[`distribution/`](distribution/README.md).

> **Status — honest version:** the native Ungoogled-Chromium *fork binary* (own
> branding/icon) isn't compiled yet (it's a ~50 GB build). Today `tron` runs an
> Ungoogled Chromium / Chromium on your system (**never Google Chrome**) in an
> isolated TronBrowser profile, with the de-googling done by the bundled
> **extension**. Same install/CLI; the native binary drops in later with no
> change for users.

## What you get today

- **De-googled new tab** — TronBrowser page, **Xprivo** as the default private
  search (no Google in the omnibox; DuckDuckGo available as an alternative), quick links.
- **RSS reader** on the new tab — seeded from your OPML; add/remove feeds and
  **import/export OPML** in Settings.
- **AI sidebar (bring your own keys)** — Anthropic, OpenAI, Google/Gemini,
  DeepSeek, Perplexity, Kimi, Qwen, or local (Ollama/LM Studio/vLLM).
- **CoinPay OAuth login** (not Google) — anonymous, optional email; settings sync
  to the cloud SQLite (Turso) or your own self-hosted backend.
- Keeps all Chromium features: extensions, profiles, bookmarks, history, PWAs,
  DevTools.

## Monorepo

| Path | Contents |
| --- | --- |
| `apps/` | `desktop` (Chromium fork pipeline + launcher + AI-sidebar extension), `web` (tronbrowser.dev site), `mobile` (Expo/EAS, Phase 2), `docs` |
| `packages/` | `ai-core`, `model-providers`, `browser-core`, `workflow-engine`, `agent-runtime`, `auth`, `payments` (x402/CoinPay), `sync`, `storage`, `sdk`, `plugins`, `ui`, `shared` |
| `services/` | `api`, `worker`, `scheduler`, `sync-server` |
| `distribution/` | package-manager manifests for every channel |

## Develop

Requirements: **Node 24+**, **pnpm 9+**.

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm build
```

**Secrets/env** via [Doppler](https://doppler.com) (project `tronbrowser`):
`doppler setup` then `doppler run -- <cmd>` injects `TRONBROWSER_DB_URL` etc.
`.env.example` documents everything; `.env` is a gitignored fallback.

**Database** (Turso/libSQL) uses tracked migrations:

```bash
doppler run -- pnpm db:migrate    # apply pending migrations
pnpm db:status                    # applied vs pending
```

## Build the Chromium fork (heavy)

The Ungoogled-Chromium fork pipeline lives in
[`apps/desktop/chromium/`](apps/desktop/chromium/) (pinned versions, GN args,
branding, patch series, guarded fetch/build scripts). It needs ~50 GB and a
capable machine; see its [README](apps/desktop/chromium/README.md) and
[ADR 0001](docs/adr/0001-chromium-fork-base.md).

## Release

Tag-driven, per-platform CI/CD (one repo, not 50):

```bash
pnpm version:set 0.1.4 && git tag v0.1.4 && git push origin v0.1.4
```

`release.yml` builds linux/macos/windows artifacts (+ .deb/.rpm/AppImage) and
publishes a GitHub Release; `submit-packages.yml` refreshes the package managers.

## Milestones

| | Milestone | Status |
| --- | --- | --- |
| **M0** | Monorepo scaffold | ✅ done |
| **M1** | Chromium fork | 🟡 pipeline + launcher + de-googled extension shipped; native binary not yet compiled |
| **M2** | AI sidebar | ✅ done (BYOK, streaming, side panel) |
| M3 | Browser agents | ⬜ |
| **M4** | Cloud services | 🟡 DB schema + sync client + migrations done; auth/sync API + web login not yet deployed |
| **M5** | Mobile (React Native) | 🟡 Expo app linked to EAS (Phase 2 stub) |
| M6 | Plugins | ⬜ |
| M7 | Agent swarms | ⬜ |

## License

[MIT](LICENSE) © [Profullstack, Inc.](https://profullstack.com)
