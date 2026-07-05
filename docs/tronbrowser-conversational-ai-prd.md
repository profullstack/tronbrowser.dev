# PRD: Conversational AI Overhaul (Phase 1) — Technical

**Status:** Draft v1
**Owner:** Product + Eng
**Last updated:** 2026-07-04
**Companion to:** the product PRD ("TronBrowser Conversational AI Overhaul"). This
document is the engineering-grounded version: it maps the product goals onto the
code that exists today and resolves the blocking decisions before they block build.

---

## 0. TL;DR

TronBrowser already streams AI responses — but it does so by calling provider APIs
**directly from the extension using the user's own API key** (BYOK). This is the
opposite of the product PRD's stated P0 ("never ship keys to the client — proxy
through our backend"). **Almost every P0 backend requirement (streaming proxy,
per-user cost caps, page-content disclosure scope) is undefined until we decide
whether v1 stays BYOK or adds a platform-key tier.** That decision is Section 2 and
gates the rest.

Everything the *user sees* — persistence, Stop, regenerate, feedback, tables/code
rendering, consent UX, real error handling — is client-side work that is **valuable
regardless of the key decision** and should proceed in parallel.

---

## 1. Current state (grounded in code)

| Area | Where | Reality today |
|------|-------|---------------|
| Streaming | `apps/desktop/extensions/ai-sidebar/providers.js:81` (`chatStream`) | Works. Client calls provider **directly**; `providers.js:96` sets `anthropic-dangerous-direct-browser-access: true`. SSE parsed in-browser. |
| Key handling | `options.js` + `vault.js` | **BYOK.** User's key in `chrome.storage.local`, optionally E2E-encrypted vault synced via `/api/settings`. |
| Backend | `services/api/src/index.ts` | Hono on Railway. Has `/api/models` (BYOK model *listing* proxy, `index.ts:183`) and `/api/swarm` (agent swarm, **non-streaming**, `swarm.ts:74`). **No streaming chat proxy.** |
| Server stream adapter | `packages/model-providers/src/adapter-anthropic.ts:93`, `adapter-openai.ts:74` | `async *stream()` exists and is server-capable — but **not wired to any HTTP route**. Reusable building block. |
| Conversation state | `sidepanel.js:19` (`const history = []`) | **In-memory only. Lost on panel close/reopen.** No truncation, no "New chat". |
| Markdown | `markdown.js` | Headings, lists, bold/italic/strike, links, inline + fenced code (`data-lang`). **No tables. No syntax highlighting. No per-code-block copy** (only whole-message "Copy markdown"). |
| Page context | `sidepanel.js:82` (`pageContext`) | Sends **title + URL only**, not page body. `use-page` checkbox. No per-site allow/deny, no persistent indicator. |
| Errors | `sidepanel.js:116` | Single generic `Error: {message}`. **No timeout, no rate-limit/timeout distinction, no Retry.** |
| Stop / regenerate / feedback | — | **None.** |
| Instrumentation | — | **None** — and `CLAUDE.md` rule #1 is "No telemetry by default" (see §5). |

**Duplication risk:** two provider implementations exist — the client `providers.js`
and the `@tronbrowser/model-providers` package — and they have drifted (the package
streams server-side; the client reimplements streaming inline). Phase 1 must
consolidate, not add a third.

---

## 2. The pivotal decision: BYOK vs. platform-key

This is the one product/eng decision the whole phase hangs on.

### Option A — Stay BYOK for v1 (recommended)
Keep client-direct streaming. Users bring their own provider key.

- **Pros:** streaming already works; matches the privacy brand ("No telemetry",
  E2E key vault, data flows under the *user's own* provider ToS); **no new backend,
  no cost exposure, no metering, lightest legal surface**; unblocks Phase 1 today.
- **Cons:** high activation friction (user must obtain + paste an API key); no
  monetization hook; the product PRD's "never ship keys to client" note is
  **explicitly not met** — but under BYOK the key is the *user's own*, so the
  original security rationale (protecting *our* platform key) doesn't apply.
- **Consequence for open questions:** streaming proxy = **not needed**; cost caps
  = **N/A** (user pays); page-content disclosure = user→their-own-provider (lighter).

### Option B — Add a platform-key "cloud" tier (defer to Phase 3)
Introduce our keys behind an authenticated, metered streaming proxy. The
interface is already sketched in `packages/model-providers/src/keys.ts:5`
("cloud" `KeySource`, per-app vault) but **is not implemented**.

- **Pros:** zero-friction onboarding, monetization, we control model routing.
- **Cons:** net-new SSE proxy (build on the existing `model-providers` `stream()`),
  per-user metering + budget caps, abuse/rate-limit handling, and the **full**
  third-party-data-disclosure legal surface. This is where the product PRD's
  security note actually applies.

### Recommendation
**Ship Phase 1 as BYOK.** Treat the platform-key tier as a **separate Phase 3
initiative** with its own cost model and legal review. Design the client so the
key source is abstracted (a `resolveKey()` seam) so that adding a cloud tier later
does not require rewriting the chat surface. This lets Phase 1 start now and keeps
the product PRD's proxy work from blocking the 80%-of-the-gap UX wins.

> **Blocking sign-off needed** from Product + Finance + Legal on A vs. B before any
> backend proxy work is scheduled. Until then, all §4 work assumes Option A.

---

## 3. Scope

**In (Phase 1, all client-side, BYOK):**
Persistence + "New chat", Stop, regenerate, per-message copy, thumbs feedback
(local), tables + syntax highlighting + code-copy, real error/timeout handling,
consolidation onto one provider layer, opt-in local-only instrumentation.

**Out (later phases):**
Platform-key proxy + cost caps (Phase 3, §2 Option B); full page-**content**
context + consent UX and its legal review (Phase 2 — depends on privacy sign-off);
agentic actions, voice, model picker, offline models (product PRD non-goals).

---

## 4. Requirements → implementation

### R1. Streaming resilience (P0-1)
Streaming exists; close the gaps.
- [ ] Explicit "thinking" indicator between submit and first token (replace the
      silent empty assistant bubble in `sidepanel.js:104`).
- [ ] Wrap the fetch in an `AbortController` with a hard timeout so no stream spins
      forever (satisfies product-PRD "every state resolves within 30s").
- [ ] On network drop mid-stream: **preserve accumulated `acc`** and offer Retry
      instead of throwing (`sidepanel.js:116`).
- **Acceptance:** first token still renders <800ms p50; interrupted stream keeps
  partial text + shows Retry.

### R2. Conversation persistence + New chat (P0-2)
- [ ] Persist `history` to `chrome.storage.local` (per-conversation), rehydrate on
      panel open — fixes the "lost on close" defect.
- [ ] Token-budget truncation strategy (oldest-first, keep system + last N turns).
- [ ] "New chat" control that clears state and starts a fresh conversation id.
- **Storage lives client-local** (matches privacy posture; no server conversation
  store in v1). Consistent with the product PRD's own recommendation.

### R3. Stop generation (P0-3)
- [ ] Stop button visible during streaming; aborts the `AbortController` from R1
      and keeps partial output. (Client-direct, so "abort server-side" from the
      product PRD becomes "abort the client fetch" under Option A.)

### R4. Rich rendering (P0-4)
Extend `markdown.js` (keep it dependency-free + XSS-safe — escape first):
- [ ] **Tables** (GFM pipe tables) — currently unsupported, explicitly required.
- [ ] **Syntax highlighting** for fenced blocks (a small, self-contained
      highlighter; no CDN — MV3/CSP forbids remote scripts).
- [ ] **Per-code-block copy button** (today only whole-message "Copy markdown").
- [ ] Keep progressive re-render; debounce re-parse on rapid deltas.

### R5. Feedback + regenerate + copy (P0-5)
- [ ] Thumbs up/down per assistant message → **local** log (see §5).
- [ ] Regenerate re-runs the last turn (drop last assistant entry, re-send).
- [ ] Per-message copy (rendered text), in addition to existing copy-markdown.

### R6. Error + limit handling (P0-7)
- [ ] Distinct plain-language messages for 401 (bad/expired key), 429 (rate limit),
      timeout, and network — each with a recovery action (fix key / retry / wait).
- [ ] No infinite spinners (covered by R1 timeout).

### R7. Consolidation (cross-cutting)
- [ ] Reconcile client `providers.js` with `@tronbrowser/model-providers` so there
      is one streaming implementation. Introduce a `resolveKey()` seam so a future
      cloud tier (§2-B) is additive.

### R8. Instrumentation (P0 day-one — see §5 for the tension)
- [ ] Events: submit, first-token latency, stop, regenerate, rating, error — **but
      opt-in and local-first** per §5. Ship with the feature, not after.

### Deferred to Phase 2 (needs privacy/legal sign-off): Page-content context (P0-6)
- Extract current page **body** (not just title/URL), gated by an explicit action.
- Per-site allow/deny; default OFF.
- Persistent "page content is in context" indicator.
- **Blocker:** disclosure review for sending page content to a third party (lighter
  under BYOK, but still a policy change).

---

## 5. Instrumentation vs. "No telemetry by default"

The product PRD makes event instrumentation a **P0 day-one** deliverable. `CLAUDE.md`
rule #1 is **"No telemetry by default."** These collide and must be reconciled by
Product + Privacy before R8 ships. Recommended reconciliation:

1. **Local-only by default:** metrics (time-to-first-token, turns, error rate)
   computed and stored **on-device**; the user can view them, nothing leaves.
2. **Explicit opt-in** for any aggregate reporting, framed consistently with the
   privacy brand.
3. Product's leading metrics (p50/p95 latency, turns/convo) are largely satisfiable
   from local/opt-in data; the WAU-engagement lagging metric needs opt-in aggregate
   or a privacy-preserving count.

Without this reconciliation, R8 as literally written in the product PRD violates a
hard project rule.

---

## 6. Open questions — status after this analysis

| Product-PRD question | Resolution here |
|----------------------|-----------------|
| Backend streaming proxy — exists or net-new? | Net-new, **but only needed under Option B**. Under recommended Option A, not needed; server `stream()` adapter is ready if B is chosen later. |
| Conversation state — client vs server? | **Client-local** (R2). Aligns with privacy posture + product PRD recommendation. |
| API cost model / per-user budget? | **N/A under BYOK** (Option A). Becomes a real question only with the Phase 3 cloud tier (Option B). |
| Legal: page content to third-party APIs? | Deferred with R6/Phase 2. Lighter under BYOK (user→own provider) but still a policy update. |
| Instrumentation vs. no-telemetry rule | Reconcile via §5 (local-first, opt-in). **Blocking for R8.** |

---

## 7. Phasing

- **Phase 1 (now, BYOK):** R1–R8 minus R8's aggregate reporting. Closes ~80% of the
  perceived gap with no backend or legal dependency.
- **Phase 2 (after privacy sign-off):** R6 page-content context + consent UX.
- **Phase 3 (separate initiative):** §2 Option B platform-key cloud tier — SSE
  proxy on the existing `model-providers` `stream()`, metering, cost caps.

## 8. Dependencies / sign-offs before build
- **Product + Finance + Legal:** BYOK vs. platform-key for v1 (§2). *Blocks §7 Phase 3 scheduling.*
- **Product + Privacy:** instrumentation reconciliation (§5). *Blocks R8.*
- **Privacy/Legal:** page-content disclosure (§4 R6). *Blocks Phase 2.*
