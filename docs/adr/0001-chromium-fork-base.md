# ADR 0001: Chromium fork base

- Status: Accepted
- Date: 2026-06-24
- Milestone: M1

## Context

TronBrowser is privacy-first: no telemetry by default, no Google phone-home, no
sponsored surfaces (PRD §Principles). We must also preserve Chrome extension
compatibility, profiles, bookmarks, history, PWAs, and DevTools (PRD §Desktop).

We can base the fork on either upstream Chromium directly (and strip Google
ourselves) or on Ungoogled Chromium.

## Decision

Base the fork on **Ungoogled Chromium**, pinned to a specific tag in
`apps/desktop/chromium/config/version.json`.

Ungoogled Chromium already removes Google integration, blob binaries, and
phone-home call sites while keeping the Blink engine and extension APIs intact.
TronBrowser-specific changes (branding, residual-telemetry removal, sponsored
surface removal, default search/new-tab) are layered on top as a small, ordered
patch series applied after the Ungoogled patch set.

## Consequences

- Much smaller TronBrowser patch surface than de-Googling Chromium ourselves.
- We inherit Ungoogled's update cadence; version bumps are deliberate.
- Web compatibility caveats from Ungoogled (e.g. no Google Sync, manual
  extension install) are inherited and must be documented for users.
- Widevine DRM is off by default and opt-in.
