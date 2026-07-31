# AI analyze (M3.5)

`tron analyze` inspects the current page of a managed session and answers "what
is this asking for, and what should I do next?" — mapping forms to your data,
proposing a safe plan, and (with `--execute`) filling low-risk fields under a
strict safety policy. **Dry-run by default.**

```sh
tron analyze                              # describe the page's forms
tron analyze form --json                  # machine-readable form map
tron analyze "Fill this contact form" --data ./lead.json
tron analyze "Fill this contact form but do not submit" --data ./lead.json --execute --no-submit
tron analyze "Fill and submit" --data ./lead.json --execute --allow-submit
```

`--data` accepts a file, inline JSON, or `-` (stdin):

```json
{ "lead": { "name": "Jane Doe", "email": "jane@example.com", "message": "Please send pricing." } }
```

## What it does

- **Maps fields to data** deterministically: labels/placeholders/ARIA/`name` are
  matched to your data paths (synonyms like *e-mail → email*, *organization →
  company*) with a confidence score. Plans reference `lead.email`, never the
  value — so values stay out of logs and traces.
- **Reports missing required data** and **ambiguous** mappings instead of
  guessing.
- **Safety policy** (`--policy safe|auto|ask`, default `safe`):
  - Credential/payment/PII fields (password, card, CVV, SSN, API key…) are
    **never auto-filled**.
  - A final submit needs `--allow-submit`; `--no-submit` fills but never submits.
  - Payment/irreversible submits (*Pay*, *Delete account*, *Transfer*…) are
    **blocked even with `--allow-submit`**.
  - A CAPTCHA/challenge stops the loop.
- **`--execute`** runs a bounded (`--max-steps`, default 8), validated loop:
  fill low-risk fields, then stop before the gated submit. Stale refs, missing
  data, ambiguity, challenges, and max-steps all end the loop cleanly.

## Output

Text by default; `--json` for a machine-readable `AnalyzeResult` (status,
`detectedForms`, `plan`, `nextAction`, `missingData`, `ambiguous`, `reason`).
Statuses: `planned`, `acted`, `complete`, `needs_confirmation`, `blocked`,
`ambiguous`, `failed`.

## From the SDK

```ts
const result = await page.analyze('Fill contact form', { data: lead });      // dry-run
await page.analyze('Fill contact form', { data: lead, execute: true, noSubmit: true });
```

`page.step()` runs one bounded step; `page.runTask()` runs the loop to
completion.

## Scope

- The **form-fill path is deterministic** (no LLM) and fully covered by tests.
- **Open-ended navigation** goals (e.g. "click through onboarding until the
  dashboard") need a configured AI provider; without one, analyze returns
  `AI_PROVIDER_NOT_CONFIGURED` rather than guessing. Wiring the BYOK/local
  provider planner is a follow-up.
- Requires Node ≥22 and a running managed session (`tron browser launch`).
- Logic lives in `packages/agent-runtime/src/analyze`.
