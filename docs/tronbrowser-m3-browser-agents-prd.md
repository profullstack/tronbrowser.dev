# PRD: TronBrowser M3 — Browser Agents, AI Analyze, and Automation

**Target monorepo path:** `docs/tronbrowser-m3-browser-agents-prd.md`  
**Document owner:** TronBrowser team  
**Status:** Draft v0.3  
**Date:** 2026-07-04  
**Product area:** Desktop browser, existing `tron` CLI, browser automation, AI agents, MCP  
**Related milestones:** M1 Chromium fork/launcher, M2 AI sidebar, **M3 Browser agents**, M6 Plugins

---

## 1. Executive Summary

M3 should make the existing TronBrowser/Ungoogled Chromium product programmable by developers and AI agents without creating a new browser engine, a new repository, or a new public CLI binary.

The core M3 addition is an AI-assisted browser automation loop exposed through the existing `tron` CLI:

```bash
tron snapshot --json
tron click @e3
tron fill @e4 "hello@example.com"
tron analyze "Fill out this contact form" --data ./lead.json
tron analyze "Fill out this contact form but do not submit" --data ./lead.json --execute --no-submit
tron analyze "Click through onboarding until the dashboard is visible" --execute --max-steps 8
tron mcp --headless
```

`tron analyze` is the new high-level command for unknown interfaces. It should inspect the current page, infer what forms and controls are asking for, map user-provided data to fields, propose a safe action plan, optionally execute bounded steps, verify progress after each step, and stop when blocked, ambiguous, unsafe, or complete.

MCP must expose the same capability so external agents can either use low-level browser primitives or delegate an entire bounded task to TronBrowser:

```txt
browser_snapshot
browser_analyze
browser_step
browser_run_task
browser_click
browser_fill
browser_extract
```

---

## 2. Product Decisions

### 2.1 Keep the current browser strategy

M3 uses the existing TronBrowser/Ungoogled Chromium/Chromium backend.

M3 does **not** build a new Rust browser engine, rendering engine, JavaScript engine, extension platform, or MV3 implementation.

### 2.2 Extend the existing `tron` CLI

M3 does **not** create a new public binary such as:

```bash
trond
tronctl
tron-engine
tron-automate
```

The only public command remains:

```bash
tron
```

Internal helper processes are allowed only if they are automatically launched and managed by `tron`.

### 2.3 Stay inside the existing monorepo

All M3 code lands in the existing `tronbrowser.dev` monorepo. No new repository should be created.

Recommended target areas:

```txt
apps/desktop/launcher/              # existing tron CLI and launch logic
apps/desktop/extensions/            # current extension/feed/sidebar architecture
packages/browser-core/              # browser/session/page/snapshot types
packages/agent-runtime/             # analyze loop, planner, validator, MCP wrappers
packages/workflow-engine/           # browser workflow nodes
packages/sdk/                       # public TypeScript SDK
services/                           # optional local services if already aligned with repo patterns
docs/                               # this PRD and user/developer docs
```

---

## 3. Goals

1. Preserve existing `tron <url>`, `tron --tor`, `tron upgrade`, `tron remove`, and `tron version` behavior.
2. Add browser automation commands to the existing `tron` CLI.
3. Add structured page snapshots optimized for AI agents.
4. Add stable element refs such as `@e1`, `@e2`, and `@e3`.
5. Add `tron analyze` for AI-assisted unknown-interface navigation and form filling.
6. Add headless one-shot automation for CI and agent workflows.
7. Add MCP support through `tron mcp`.
8. Add a TypeScript/JavaScript SDK through the existing SDK package.
9. Add trace/replay artifacts for debugging failed agent runs.
10. Keep browser control local-first and privacy-preserving by default.

---

## 4. Non-Goals

M3 explicitly does **not** include:

1. A custom Rust browser engine.
2. A new `tron-engine` repo.
3. A separate public automation CLI.
4. Reimplementation of HTML, CSS, JavaScript, DOM, rendering, networking, storage, or extensions.
5. Reimplementation of Manifest V3.
6. Full Playwright replacement in M3.
7. CAPTCHA bypassing, bot evasion, stealth automation, or anti-abuse circumvention.
8. Blind automation of payments, banking, healthcare, legal filings, tax/government forms, or destructive account actions.
9. Public remote browser control by default.
10. Cloud browser sessions in the first M3 release.

---

## 5. Target Users

### 5.1 AI Agent Builders

Developers building agents that need to inspect pages, fill forms, click through unknown interfaces, extract data, and produce reproducible traces.

### 5.2 Power Users

Users who want repeatable browser workflows from a terminal without writing Playwright/Selenium code.

### 5.3 TronBrowser Team

Internal workflows for smoke tests, extension validation, feed-page checks, onboarding tests, AI sidebar tests, and regression testing.

### 5.4 MCP Clients and AI Coding Agents

External agents that want browser access via a standard tool interface rather than shelling out to ad hoc scripts.

---

## 6. Core UX Principles

1. **One command:** everything is exposed through the existing `tron` CLI.
2. **Snapshot first:** agents should reason from structured page state, not screenshots alone.
3. **Refs over selectors:** agents should prefer stable refs like `@e4` over brittle CSS selectors.
4. **Plan before action:** AI-assisted unknown-interface workflows default to dry-run planning.
5. **One step at a time:** execution should re-snapshot and re-plan after every meaningful action.
6. **Safe by default:** final submits, destructive actions, payments, and sensitive disclosures require confirmation or explicit policy.
7. **Local-first:** no hidden hosted AI calls; use configured BYOK/local AI settings.
8. **Composable:** CLI, SDK, MCP, and workflow engine all use the same underlying browser primitives.

---

## 7. CLI Requirements

### 7.1 Existing commands that must continue working

```bash
tron <url>
tron --tor [url]
tron upgrade
tron remove
tron version
```

### 7.2 New M3 command map

```bash
tron open <url>
tron browser <subcommand>
tron headless <url> [options]
tron snapshot [options]
tron analyze [goal|mode] [options]
tron click <target>
tron fill <target> <value>
tron type <target> <value>
tron press <key>
tron select <target> <value>
tron scroll <direction|amount>
tron extract <mode|selector> [options]
tron screenshot <path>
tron pdf <path>
tron cookies <subcommand>
tron storage <subcommand>
tron trace <subcommand>
tron run <script>
tron mcp [options]
```

---

## 8. Browser Session Commands

```bash
tron browser launch
tron browser status
tron browser tabs
tron browser use <tab-id>
tron browser current
tron browser close
```

Requirements:

- `tron browser launch` starts a managed automation-capable TronBrowser session.
- `tron browser status` shows whether a managed session exists.
- `tron browser tabs` returns active tab IDs, titles, URLs, and current-tab state.
- `tron browser use <tab-id>` changes the active automation target for subsequent commands.
- Users should not need to manually start a daemon.
- Headless sessions should default to ephemeral profiles unless a profile is explicitly passed.

---

## 9. Snapshot Command

```bash
tron snapshot
tron snapshot --json
tron snapshot --interactive
tron snapshot --refs
tron snapshot --include-hidden
```

Default text output:

```txt
Page: Example Domain
URL: https://example.com

@e1 heading "Example Domain"
@e2 paragraph "This domain is for use in illustrative examples..."
@e3 link "More information..."
```

Default JSON output:

```json
{
  "url": "https://example.com",
  "title": "Example Domain",
  "elements": [
    {
      "ref": "@e1",
      "role": "heading",
      "name": "Example Domain",
      "visible": true,
      "interactive": false
    },
    {
      "ref": "@e3",
      "role": "link",
      "name": "More information...",
      "visible": true,
      "interactive": true,
      "href": "https://www.iana.org/domains/example"
    }
  ]
}
```

Requirements:

- Produce stable refs for the current snapshot.
- Prioritize visible interactive elements by default.
- Include role, accessible name, value, visibility, disabled state, checked state, selected state, and bounds when available.
- Include URL, title, viewport, timestamp, and focused element.
- Avoid huge token-heavy dumps by default.
- Return compact text for humans/agents and JSON for scripts/MCP.

---

## 10. Direct Action Commands

```bash
tron click @e3
tron fill @e4 "hello@example.com"
tron type @e4 "hello@example.com"
tron press Enter
tron select @e5 "United States"
tron hover @e6
tron scroll down
tron scroll 800
```

Requirements:

- Actions operate on the current active tab unless `--tab` is passed.
- Ref-based actions use the latest snapshot ref map.
- Stale refs return recoverable errors and suggest `tron snapshot`.
- Every mutating action supports `--snapshot` to return fresh state.
- MCP mutating actions return a fresh snapshot by default.

Supported targets:

```txt
@e3                                  # snapshot ref
css=input[type=email]                # explicit CSS selector
text=Sign in                         # visible text
role=button[name="Sign in"]          # accessibility-style selector
```

For agents, `@eN` refs are preferred over CSS selectors.

---

## 11. AI Analyze Command

`tron analyze` is the AI-assisted command for unknown interfaces. It should answer: “What is this page asking for, and what should I do next?”

It can operate in two broad modes:

1. **Dry-run / plan mode** — default. It analyzes the page and returns a form map, plan, next action, missing data, risk, and confidence.
2. **Execution mode** — enabled with `--execute`. It performs bounded, validated, step-by-step browser actions.

### 11.1 Command examples

```bash
tron analyze
tron analyze form
tron analyze form --json
tron analyze "What is this page asking me to do?"
tron analyze "Find the required fields in this form" --json
tron analyze "Fill out this contact form using my lead data" --data ./lead.json
tron analyze "Fill out this contact form but do not submit" --data ./lead.json --execute --no-submit
tron analyze "Fill and submit the demo request form" --data ./demo-request.json --execute --allow-submit
tron analyze "Click through onboarding until the dashboard" --execute --max-steps 8
tron analyze "Find the pricing page from here" --execute --max-steps 5
tron analyze "Find the pricing page and report the Pro plan" --url https://example.com --max-steps 8 --json
```

### 11.2 Recommended flags

```bash
--url <url>                    # open URL before analyzing
--data <path|json|->           # JSON data used to fill forms; '-' means stdin
--goal <text>                  # explicit task goal if not passed positionally
--mode plan|form|next|run      # analysis mode
--execute                      # allow bounded mutating browser actions
--dry-run                      # force plan-only behavior; default
--no-submit                    # fill/navigate but never submit forms
--allow-submit                 # allow ordinary low-risk form submission
--confirm-each-step            # ask before every mutating action when interactive
--max-steps <n>                # cap planner/executor loop
--policy safe|ask|auto         # default: safe
--headless                     # run in headless mode
--profile <name|ephemeral>     # select profile
--json                         # machine-readable output
--snapshot                     # include final snapshot
--trace <path>                 # save action loop trace
--model <provider:model>       # optional override for configured AI provider
```

### 11.3 Default policy

`tron analyze` is dry-run by default.

`--execute` is required before the command can click, fill, type, navigate, upload, download, or submit.

Default policy is `safe`:

```txt
safe  # plan-only unless --execute; no final submit without --allow-submit; no destructive/high-risk actions
auto  # allows low-risk form filling/navigation; still blocks destructive/high-risk actions
ask   # asks before risky or ambiguous steps when an interactive terminal is available
```

Even with `--allow-submit`, the following should remain blocked or require explicit interactive confirmation:

- Payments and checkout.
- Banking and financial forms.
- Healthcare/medical forms.
- Legal, tax, government, or immigration submissions.
- Account deletion or irreversible settings changes.
- Password changes, MFA changes, API-key creation, or secret disclosure.
- File uploads unless the file path is explicitly provided and confirmed.

### 11.4 Analyze input contract

`--data` accepts a JSON file, inline JSON, or stdin.

Example:

```json
{
  "lead": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "company": "Acme Inc",
    "message": "I would like to request a demo."
  }
}
```

The planner should prefer referencing data paths such as `lead.email` instead of echoing sensitive values in logs/traces.

### 11.5 Human output example

```txt
Goal: Fill out this contact form using ./lead.json
Page: Contact Us
URL: https://example.com/contact

Detected form: Contact / sales inquiry
Required fields:
- @e2 textbox "Name"        <- lead.name       confidence 0.98
- @e3 textbox "Email"       <- lead.email      confidence 0.99
- @e4 textbox "Company"     <- lead.company    confidence 0.91
- @e5 textarea "Message"    <- lead.message    confidence 0.94

Proposed plan:
1. Fill @e2 from lead.name
2. Fill @e3 from lead.email
3. Fill @e4 from lead.company
4. Fill @e5 from lead.message
5. Stop before @e6 button "Submit" because --allow-submit was not provided

Missing data: none
Risk: low
Next action: fill @e2 from lead.name
```

### 11.6 JSON output example

```json
{
  "ok": true,
  "mode": "dry-run",
  "status": "planned",
  "goal": "Fill out this contact form using ./lead.json",
  "page": {
    "url": "https://example.com/contact",
    "title": "Contact Us"
  },
  "detectedForms": [
    {
      "ref": "@form1",
      "name": "Contact / sales inquiry",
      "requiredFields": ["name", "email", "company", "message"],
      "submitRef": "@e6"
    }
  ],
  "missingData": [],
  "plan": [
    {
      "step": 1,
      "action": "fill",
      "target": "@e2",
      "label": "Name",
      "valueFrom": "lead.name",
      "risk": "low",
      "confidence": 0.98,
      "requiresConfirmation": false
    },
    {
      "step": 5,
      "action": "click",
      "target": "@e6",
      "label": "Submit",
      "risk": "medium",
      "requiresConfirmation": true,
      "blockedReason": "Final submit requires --allow-submit"
    }
  ],
  "nextAction": {
    "action": "fill",
    "target": "@e2",
    "valueFrom": "lead.name"
  },
  "confidence": 0.86
}
```

### 11.7 Execution loop

When `--execute` is passed, `tron analyze` becomes a bounded planner/executor/validator loop:

```txt
1. Snapshot the current page.
2. Extract forms, labels, placeholders, ARIA metadata, validation messages, buttons, links, headings, and URL/title.
3. Optionally capture a screenshot when the structured snapshot is insufficient.
4. Build an AI task context containing goal, page state, prior steps, user data, allowed actions, and safety policy.
5. Ask the planner for the next safe step or bounded plan.
6. Validate the proposed action against the latest snapshot/ref map.
7. Execute at most one mutating browser action.
8. Take a fresh snapshot.
9. Verify whether the action worked and whether the goal is complete.
10. Replan until complete, blocked, ambiguous, unsafe, or max steps is reached.
```

The executor must never blindly replay a long plan against stale page state.

### 11.8 Blocked and ambiguous states

`tron analyze` must stop with a useful response when:

- Required data is missing.
- Multiple plausible controls match the next action.
- A CAPTCHA or anti-abuse challenge appears.
- Authentication is required and credentials were not provided.
- The page asks for high-risk information.
- The next action is destructive, irreversible, or outside the stated goal.
- Planner confidence falls below the configured threshold.

Example blocked response:

```json
{
  "ok": false,
  "status": "blocked",
  "reason": "MISSING_REQUIRED_DATA",
  "message": "The form requires a phone number, but no matching value was provided.",
  "missingData": [
    {
      "field": "phone",
      "label": "Phone number",
      "target": "@e5"
    }
  ],
  "snapshotRequired": false
}
```

---

## 12. Extraction Commands

```bash
tron extract text
tron extract links
tron extract forms
tron extract tables
tron extract main
tron extract '.product-card' \
  --field title='.title' \
  --field price='.price' \
  --field url='a@href' \
  --json
```

Requirements:

- Return clean JSON with deterministic field names.
- Resolve relative URLs to absolute URLs by default.
- Support links, forms, headings, tables, and main-content helpers.
- Avoid raw `eval` when a safer extraction primitive exists.

---

## 13. Script Execution

```bash
tron run ./agents/example.js
tron run ./agents/example.ts
tron run ./agents/example.ts --headless
tron run ./agents/example.ts --profile work
tron run ./agents/example.ts --trace traces/example.trontrace
```

Requirements:

- Use the existing monorepo Node/pnpm/TypeScript stack.
- JavaScript must work in MVP.
- TypeScript should work without a separate manual build step using the repo’s existing TypeScript runtime/bundling approach.
- Scripts should import from the existing SDK path, preferably `@tronbrowser/sdk`.
- Bun is not required for MVP unless the team chooses it as an internal implementation detail.

Example:

```ts
import { tron } from "@tronbrowser/sdk";

const browser = await tron.launch({ headless: true, profile: "ephemeral" });
const page = await browser.newPage();

await page.goto("https://example.com/contact");

const result = await page.analyze("Fill out this contact form", {
  data: {
    lead: {
      name: "Jane Doe",
      email: "jane@example.com",
      message: "Please send pricing information."
    }
  },
  mode: "form"
});

console.log(result.plan);
await browser.close();
```

---

## 14. MCP Requirements

MCP support starts from the existing `tron` CLI:

```bash
tron mcp
tron mcp --headless
tron mcp --profile ephemeral
tron mcp --profile work --headed
```

### 14.1 Tool groups

Primitive browser tools:

```txt
browser_open
browser_snapshot
browser_click
browser_fill
browser_type
browser_press
browser_select
browser_scroll
browser_wait
browser_extract
browser_screenshot
browser_tabs
browser_close
```

AI-assisted unknown-interface tools:

```txt
browser_analyze
browser_step
browser_run_task
```

### 14.2 `browser_analyze`

Non-mutating by default. It inspects the current page or URL and returns a page summary, form map, recommended next action, risk level, confidence, missing data, and confirmation requirement.

Input:

```json
{
  "url": "https://example.com/contact",
  "goal": "Fill out this contact form",
  "data": {
    "lead": {
      "name": "Jane Doe",
      "email": "jane@example.com",
      "message": "Please send pricing information."
    }
  },
  "mode": "form",
  "allowActions": false
}
```

Output:

```json
{
  "status": "planned",
  "summary": "One contact form detected.",
  "formFields": [
    {
      "target": "@e2",
      "label": "Email",
      "valueFrom": "lead.email",
      "confidence": 0.99
    }
  ],
  "nextAction": {
    "action": "fill",
    "target": "@e2",
    "valueFrom": "lead.email"
  },
  "requiresConfirmation": false
}
```

### 14.3 `browser_step`

Executes exactly one validated AI-selected action for a stated goal, then returns the fresh snapshot and progress assessment.

Input:

```json
{
  "goal": "Fill out this contact form",
  "data": {
    "lead": {
      "email": "jane@example.com"
    }
  },
  "confirmPolicy": "submit"
}
```

Output:

```json
{
  "status": "acted",
  "action": {
    "type": "fill",
    "target": "@e2",
    "valueFrom": "lead.email"
  },
  "snapshot": {
    "url": "https://example.com/contact",
    "title": "Contact Us"
  },
  "progress": "Email field filled. Next required field is Message."
}
```

### 14.4 `browser_run_task`

Runs the same bounded loop as `tron analyze --execute --mode run`.

Input:

```json
{
  "goal": "Complete onboarding until the dashboard is visible",
  "data": {},
  "maxSteps": 12,
  "confirmPolicy": "submit",
  "headless": true,
  "trace": true
}
```

Requirements:

- Must cap steps.
- Must return fresh snapshots after mutating actions.
- Must stop on blocked/ambiguous/unsafe states.
- Must return trace ID/path when tracing is enabled.
- Must not expose remote browser control beyond local transport by default.
- MCP clients that prefer to reason externally can ignore `browser_analyze`, `browser_step`, and `browser_run_task` and use low-level tools directly.

---

## 15. SDK Requirements

The public developer API should live in the existing SDK package unless the team later splits internals while preserving the public import path:

```ts
import { tron } from "@tronbrowser/sdk";
```

### 15.1 Launch API

```ts
type LaunchOptions = {
  headless?: boolean;
  profile?: string | "default" | "ephemeral";
  tor?: boolean;
  viewport?: { width: number; height: number };
  executablePath?: string;
  userDataDir?: string;
  extensions?: string[];
  timeoutMs?: number;
  args?: string[];
};

const browser = await tron.launch(options);
```

### 15.2 Page API

```ts
interface Page {
  id: string;

  goto(url: string, options?: GotoOptions): Promise<ResponseSummary>;
  reload(): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;

  snapshot(options?: SnapshotOptions): Promise<AgentSnapshot>;
  snapshotText(options?: SnapshotOptions): Promise<string>;
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array>;
  pdf(options?: PdfOptions): Promise<Uint8Array>;

  click(target: Target): Promise<void>;
  fill(target: Target, value: string): Promise<void>;
  type(target: Target, value: string): Promise<void>;
  press(key: string): Promise<void>;
  select(target: Target, value: string): Promise<void>;
  hover(target: Target): Promise<void>;
  scroll(options: ScrollOptions): Promise<void>;

  extract<T = unknown>(schema: ExtractSchema): Promise<T>;
  eval<T = unknown>(code: string, args?: unknown[]): Promise<T>;

  analyze(goal?: string, options?: AnalyzeOptions): Promise<AnalyzeResult>;
  step(goal: string, options?: AnalyzeOptions): Promise<AnalyzeResult>;
  runTask(goal: string, options?: AnalyzeOptions): Promise<AnalyzeResult>;
}
```

### 15.3 Analyze types

```ts
type AnalyzeMode = "plan" | "form" | "next" | "run";
type ConfirmPolicy = "submit" | "risky" | "all" | "never";

type AnalyzeOptions = {
  data?: Record<string, unknown>;
  mode?: AnalyzeMode;
  execute?: boolean;
  noSubmit?: boolean;
  allowSubmit?: boolean;
  maxSteps?: number;
  confirmPolicy?: ConfirmPolicy;
  includeScreenshot?: boolean;
  model?: string;
};

type AnalyzeResult = {
  status:
    | "planned"
    | "acted"
    | "complete"
    | "blocked"
    | "needs_confirmation"
    | "ambiguous"
    | "failed";
  summary: string;
  snapshot: AgentSnapshot;
  formFields?: FormFieldMapping[];
  plan?: PlannedAction[];
  nextAction?: PlannedAction;
  missingData?: string[];
  requiresConfirmation?: boolean;
  risk?: "low" | "medium" | "high";
  confidence?: number;
  traceId?: string;
};
```

---

## 16. Technical Architecture

### 16.1 High-level architecture

```txt
Existing tron CLI
      │
      ▼
apps/desktop/launcher
      │
      ├── normal launch mode
      │       └── open URLs as today
      │
      ├── automation mode
      │       └── browser automation manager
      │              └── Chromium/CDP adapter
      │                     └── Ungoogled Chromium / Chromium / future branded binary
      │
      └── analyze/task mode
              └── packages/agent-runtime
                     ├── snapshot/context builder
                     ├── form understanding
                     ├── AI planner using configured BYOK/local provider
                     ├── action validator
                     └── bounded step executor
```

The public API is not CDP. CDP is an internal adapter.

### 16.2 Internal component responsibilities

#### `apps/desktop/launcher/`

- Preserve current `tron` behavior.
- Parse M3 automation subcommands.
- Start or attach to managed sessions.
- Route commands such as `snapshot`, `click`, `fill`, `analyze`, `run`, and `mcp`.
- Provide helpful `tron help` output.

#### `packages/browser-core/`

- Shared browser/session/page abstractions.
- Snapshot schema.
- Target selector schema.
- Error types.
- Analyze/task types.
- Profile and storage types.

#### `packages/agent-runtime/`

- Convert snapshots into AI-readable context.
- Implement `tron analyze` planning loop.
- Implement MCP wrappers for `browser_analyze`, `browser_step`, and `browser_run_task`.
- Build form-understanding context from labels, placeholders, validation messages, ARIA metadata, and surrounding text.
- Use configured BYOK/local AI provider settings.
- Validate proposed actions against current refs.
- Enforce confirmation policy, low-confidence fallbacks, and trace redaction.

#### `packages/sdk/`

- Export public `tron` automation API.
- Hide CDP details.
- Provide TypeScript types.
- Support `tron run` scripts.

#### `packages/workflow-engine/`

- Add browser workflow nodes.
- Reuse SDK primitives.
- Store traces and structured outputs.

---

## 17. Session Model

### 17.1 Managed session

```bash
tron browser launch --profile agent
tron open https://example.com
tron snapshot
```

A managed session is launched by `tron` with automation enabled.

Requirements:

- Use existing launcher logic.
- Use isolated profile handling consistent with the current CLI.
- Prefer ephemeral profile for headless tasks.
- Store a local session descriptor so later commands can attach.

### 17.2 One-shot headless session

```bash
tron headless https://example.com --snapshot
tron analyze "Fill contact form" --url https://example.com/contact --headless --data ./lead.json
```

Requirements:

- Create temporary profile.
- Run command.
- Save requested outputs.
- Delete profile unless `--keep-profile` or named `--profile` is passed.

### 17.3 Existing human session

Controlling a currently open human browser session is deferred unless the team chooses to build an automation bridge extension. M3 should focus first on managed sessions launched by `tron`.

---

## 18. Error Model

Base automation errors:

```txt
BROWSER_NOT_FOUND
BROWSER_CRASHED
PAGE_CLOSED
NAVIGATION_TIMEOUT
ELEMENT_NOT_FOUND
ELEMENT_NOT_INTERACTIVE
AMBIGUOUS_TARGET
STALE_REF
PERMISSION_DENIED
DOWNLOAD_BLOCKED
AUTH_REQUIRED
```

Analyze/task errors:

```txt
AI_PROVIDER_NOT_CONFIGURED
AI_PLANNER_FAILED
LOW_CONFIDENCE_ACTION
MISSING_REQUIRED_DATA
ACTION_REQUIRES_CONFIRMATION
UNSAFE_ACTION_BLOCKED
MAX_STEPS_REACHED
GOAL_NOT_VERIFIED
CAPTCHA_OR_CHALLENGE_DETECTED
```

Errors must include:

- Recoverability.
- Suggested next actions.
- Latest snapshot when useful.
- Rejected/blocked action when available.
- Risk reason.
- Missing data details when relevant.

Example:

```json
{
  "code": "AMBIGUOUS_TARGET",
  "message": "Found 3 buttons that could mean Continue.",
  "recoverable": true,
  "suggestedActions": [
    "Run tron snapshot and choose a specific ref",
    "Re-run tron analyze with a more specific goal"
  ]
}
```

---

## 19. Trace and Replay

```bash
tron trace start
tron trace stop trace.trontrace
tron replay trace.trontrace
tron analyze "Complete onboarding" --execute --trace onboarding.trontrace
```

Trace contents:

```txt
metadata.json
commands.jsonl
snapshots/
plans.jsonl
actions.jsonl
validation.jsonl
screenshots/ optional
network-summary.jsonl
console-summary.jsonl
errors.jsonl
```

Privacy defaults:

- Redact form values by default.
- Redact cookies, tokens, secrets, and auth headers.
- Store AI prompts/responses only when tracing is enabled.
- Prefer data paths such as `lead.email` over actual values in traces.

---

## 20. Security and Privacy Requirements

- Never expose remote browser control publicly by default.
- Use local sockets, named pipes, or localhost-only transports.
- Generate per-session auth tokens for local control when needed.
- Use ephemeral profiles for headless runs by default.
- Make persistent profile use explicit.
- Redact secrets, cookies, tokens, and form values from traces by default.
- Do not expose raw cookies or local storage to MCP unless explicitly requested.
- `tron analyze` must be dry-run by default.
- `--execute` must be explicit for mutating actions.
- Final submits and risky actions require explicit permission.
- The AI planner receives a constrained browser-action schema, not shell access or raw CDP authority.
- Validate every AI-proposed action against the latest snapshot.
- Stop on low confidence or ambiguity rather than guessing.
- No hidden hosted model calls; use configured BYOK/local AI provider settings.

---

## 21. Implementation Plan

### 21.1 Suggested file layout

```txt
apps/desktop/launcher/
  src/cli.ts
  src/commands/open.ts
  src/commands/browser.ts
  src/commands/headless.ts
  src/commands/snapshot.ts
  src/commands/analyze.ts
  src/commands/actions.ts
  src/commands/extract.ts
  src/commands/run.ts
  src/commands/mcp.ts
  src/commands/trace.ts

packages/browser-core/
  src/automation/types.ts
  src/automation/snapshot.ts
  src/automation/target.ts
  src/automation/errors.ts
  src/automation/analyze.ts

packages/agent-runtime/
  src/browser-tools.ts
  src/analyze/context.ts
  src/analyze/forms.ts
  src/analyze/planner.ts
  src/analyze/validator.ts
  src/analyze/executor.ts
  src/mcp/tools/browser-open.ts
  src/mcp/tools/browser-snapshot.ts
  src/mcp/tools/browser-analyze.ts
  src/mcp/tools/browser-step.ts
  src/mcp/tools/browser-run-task.ts

packages/sdk/
  src/index.ts
  src/automation/browser.ts
  src/automation/page.ts
  src/automation/analyze.ts

packages/workflow-engine/
  src/nodes/browser-open.ts
  src/nodes/browser-snapshot.ts
  src/nodes/browser-analyze.ts
  src/nodes/browser-run-task.ts
  src/nodes/browser-click.ts
  src/nodes/browser-fill.ts
  src/nodes/browser-extract.ts
```

### 21.2 Package strategy

Prefer existing packages first:

- `apps/desktop/launcher` for CLI commands.
- `packages/browser-core` for shared types.
- `packages/sdk` for public developer API.
- `packages/agent-runtime` for analyze/MCP logic.
- `packages/workflow-engine` for workflow nodes.

Only create a new internal package inside `packages/` if existing packages become too large or ownership becomes unclear.

---

## 22. Milestones

### M3.0 — PRD and architecture

Deliverables:

- PRD added to `docs/`.
- CLI command map approved.
- Snapshot schema approved.
- Analyze command contract approved.
- MCP tool contract approved.
- Security model approved.

Acceptance criteria:

- No custom engine scope remains.
- No new repository is proposed.
- Existing `tron` CLI remains the only public CLI.

### M3.1 — Managed browser sessions

Deliverables:

```bash
tron browser launch
tron browser status
tron browser tabs
tron browser close
tron open <url>
```

Acceptance criteria:

- Existing `tron <url>` behavior still works.
- Managed session can launch the Chromium-compatible TronBrowser profile.
- CLI can list tabs and identify the current tab.
- Headed and headless launches work on supported platforms.

### M3.2 — Snapshots and refs

Deliverables:

```bash
tron snapshot
tron snapshot --json
tron click @e1
tron fill @e2 "text"
```

Acceptance criteria:

- Snapshot returns stable refs for visible interactive elements.
- Clicking and filling by ref works on test pages.
- Stale refs return recoverable errors.
- Snapshot output is compact enough for LLM usage.

### M3.3 — Headless and extraction

Deliverables:

```bash
tron headless <url> --snapshot
tron headless <url> --screenshot out.png
tron extract links --json
tron extract forms --json
tron extract tables --json
```

Acceptance criteria:

- One-shot headless runs work in CI.
- Extraction returns deterministic JSON.
- Screenshots work in headless mode.
- No persistent profile is used unless requested.

### M3.4 — SDK and `tron run`

Deliverables:

```bash
tron run ./agents/example.js
tron run ./agents/example.ts
```

Acceptance criteria:

- Developers can import from `@tronbrowser/sdk`.
- JavaScript and TypeScript scripts can launch, navigate, snapshot, act, extract, analyze, and close.
- `tron run --headless` works.
- `tron run --trace` writes a trace bundle.

### M3.5 — AI analyze and unknown-interface tasks

Deliverables:

```bash
tron analyze
tron analyze form --json
tron analyze "Fill this contact form" --data ./lead.json
tron analyze "Fill this contact form but do not submit" --data ./lead.json --execute --no-submit
tron analyze "Click through onboarding until the dashboard" --execute --max-steps 8
```

Acceptance criteria:

- `tron analyze` is dry-run by default.
- Form analysis maps labels/placeholders/ARIA/surrounding text to provided JSON data with confidence scores.
- `--execute` can fill low-risk fields and click low-risk navigation controls.
- Submit/risky actions require confirmation or explicit policy.
- Low-confidence or ambiguous UI choices return options instead of guessing.
- Analyze traces include snapshots, plans, actions, validations, and recovery steps.

### M3.6 — MCP server

Deliverables:

```bash
tron mcp
tron mcp --headless
```

Tools:

```txt
browser_open
browser_snapshot
browser_analyze
browser_step
browser_run_task
browser_click
browser_fill
browser_type
browser_press
browser_select
browser_scroll
browser_wait
browser_extract
browser_screenshot
browser_tabs
browser_close
```

Acceptance criteria:

- MCP clients can open a page and receive a structured snapshot.
- MCP clients can call `browser_analyze` for non-mutating page/form analysis.
- MCP clients can call `browser_step` for one AI-selected validated action.
- MCP clients can call `browser_run_task` for bounded unknown-interface automation.
- Mutating actions return a fresh snapshot.
- MCP runs locally and does not expose browser control publicly by default.

### M3.7 — Trace and replay

Deliverables:

```bash
tron trace start
tron trace stop trace.trontrace
tron replay trace.trontrace
```

Acceptance criteria:

- Traces include commands, snapshots, plans, actions, errors, console summaries, network summaries, and optional screenshots.
- Sensitive values are redacted by default.
- Basic deterministic flows can be replayed.

### M3.8 — Workflow engine integration

Deliverables:

```txt
browser.open
browser.snapshot
browser.analyze
browser.runTask
browser.click
browser.fill
browser.extract
browser.screenshot
```

Acceptance criteria:

- Workflow nodes use the same SDK primitives as CLI and MCP.
- Workflow outputs can be exported as JSON.
- Failed browser nodes include trace links and recovery details.

---

## 23. Testing Strategy

### 23.1 CLI regression tests

Must verify existing commands:

```bash
tron <url>
tron --tor [url]
tron upgrade
tron remove
tron version
```

### 23.2 Automation fixture pages

Create fixtures for:

- Buttons.
- Text inputs.
- Textareas.
- Selects.
- Checkboxes.
- Radios.
- Forms.
- Unknown forms with weak labels.
- Multi-step wizards.
- Ambiguous buttons.
- Client-side validation errors.
- Tables.
- Links.
- Navigation.
- Simple SPAs.
- Shadow DOM later.
- Downloads later.

### 23.3 Analyze tests

Example tests:

```bash
tron headless ./fixtures/contact.html --snapshot --json
tron analyze form --json
tron analyze "Fill contact form" --data ./fixtures/lead.json --dry-run
tron analyze "Fill contact form" --data ./fixtures/lead.json --execute --no-submit
tron analyze "Fill contact form" --data ./fixtures/incomplete-lead.json --json
```

Expected assertions:

- Required fields are detected.
- Data paths map to correct fields.
- Missing data is reported.
- Low-risk fields are filled with `--execute`.
- Submit button is not clicked with `--no-submit`.
- Ambiguous controls return choices.
- High-risk controls are blocked.

### 23.4 MCP tests

Must verify:

- `tron mcp` starts over local transport.
- `browser_snapshot` returns structured state.
- `browser_analyze` returns a non-mutating plan.
- `browser_step` executes one action and returns a fresh snapshot.
- `browser_run_task` respects max steps and confirmation policy.
- MCP cannot access cookies/storage unless explicitly requested.

---

## 24. Acceptance Criteria Summary

M3 is successful when:

1. Current `tron` CLI behavior is preserved.
2. `tron snapshot`, `tron click`, `tron fill`, and `tron extract` work on managed sessions.
3. `tron headless` supports one-shot snapshots, screenshots, and extraction.
4. `tron analyze` can inspect an unknown form and produce a correct field map.
5. `tron analyze --execute --no-submit` can fill a low-risk form without submitting it.
6. `tron analyze` stops safely on missing data, ambiguity, CAPTCHA/challenge, risky actions, or low confidence.
7. `tron mcp` exposes primitive browser tools plus `browser_analyze`, `browser_step`, and `browser_run_task`.
8. SDK scripts can use the same automation and analyze capabilities.
9. Traces make failed agent runs debuggable without leaking secrets by default.
10. No custom browser engine, new repo, or new public CLI binary is introduced.

---

## 25. Open Questions

1. Should `tron analyze` use the same BYOK/local provider configuration as the AI sidebar, a CLI-specific provider config, or both?
2. Should `browser_run_task` call TronBrowser’s configured AI provider internally, or should the default MCP posture leave reasoning to the MCP host?
3. What should the default confidence threshold be for executing a planned action?
4. Should `--allow-submit` be enough for ordinary contact/newsletter/search forms, or should final submission always prompt in headed mode?
5. Which TypeScript runner should power `tron run` in MVP?
6. Should trace bundles be SQLite, zip, or JSONL-first?
7. Should controlling an already-open human session be deferred until an automation bridge extension exists?

---

## 26. References

- TronBrowser site: https://tronbrowser.dev/
- TronBrowser repository: https://github.com/profullstack/tronbrowser.dev
- Model Context Protocol TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Chrome DevTools Protocol: https://chromedevtools.github.io/devtools-protocol/
- WebDriver BiDi: https://www.w3.org/TR/webdriver-bidi/
- Web Platform Tests: https://web-platform-tests.org/

---

## 27. Final Recommendation

Build M3 around the existing `tron` CLI and existing Chromium-compatible backend.

The key product wedge should be:

```bash
tron analyze "do this browser task" --execute --max-steps 8
```

paired with MCP tools:

```txt
browser_analyze
browser_step
browser_run_task
```

That gives TronBrowser a strong AI-agent-native workflow without derailing into a custom browser engine, a new repo, or a separate CLI surface.
