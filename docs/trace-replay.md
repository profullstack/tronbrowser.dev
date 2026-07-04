# Trace and replay (M3.7)

Record the automation commands you run against a managed session into a
`.trontrace` bundle, then inspect or replay them.

```sh
tron trace start ./run.trontrace   # begin recording (path optional)
tron snapshot                      # …commands are recorded as you go
tron click @e3
tron fill @e4 "hi@example.com"
tron trace status                  # show the active trace
tron trace stop                    # finalize the bundle
tron replay ./run.trontrace        # replay the recorded commands
```

`tron run --trace <dir>` also writes a (simpler) trace for SDK scripts — see
[sdk-and-run.md](./sdk-and-run.md).

## Bundle format

A `.trontrace` bundle is a directory:

```
metadata.json          version, startedAt/stoppedAt, command count
commands.jsonl         one record per command: { seq, t, name, args, snapshot?, error? }
snapshots/NNNN.json    the page snapshot captured after each command
errors.jsonl           errors keyed by command seq
```

While a trace is active, an "active trace" pointer under
`~/.tronbrowser/automation/trace.json` tells each `tron` command (a separate
process) where to append, and clears on `stop`.

## Privacy

**Form values are redacted by default.** A `tron fill @e4 "secret"` records the
ref and `value: "[redacted]"` (with `valueRedacted: true`) — never the text.
Cookies, tokens, and secrets are never written.

## Replay

`tron replay <bundle>` re-executes the recorded commands in order against the
current session: clicks and non-redacted fills are replayed; redacted fills are
**skipped** (the value isn't in the bundle), and snapshots aren't re-run.
Replay stops at the first failing command (e.g. a stale ref) and reports the
sequence number — good for reproducing deterministic navigation/click flows.

## Scope

- Requires Node ≥22 and a running managed session for recording/replay.
- Network/console summaries (PRD §19) need a persistent session listener and are
  a follow-up; the command/snapshot/error core is implemented here.
- Trace library: `packages/browser-core/src/automation/trace.ts`.
