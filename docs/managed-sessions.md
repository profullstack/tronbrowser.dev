# Managed browser sessions (M3.1)

TronBrowser can run a **managed automation session**: a normal Ungoogled Chromium
launch that also exposes a loopback Chrome DevTools Protocol (CDP) endpoint, so
the `tron` CLI (and, from M3.2, the SDK/MCP tooling) can drive it.

```sh
tron browser launch            # start a managed session (headed, "agent" profile)
tron browser launch --headless # headless, ephemeral profile (deleted on close)
tron browser status            # is a session running? (--json for machine output)
tron browser tabs              # list page tabs; "*" marks the current one (--json)
tron browser use <tab-id>      # make a tab current + bring it to the foreground
tron browser current           # print the current tab
tron open <url>                # open a URL as a tab in the managed session
tron browser close             # stop the session (and wipe an ephemeral profile)
```

`tron open <url>` prefers a running managed session; when none is running it
falls back to the classic behavior of opening the URL in a normal window, so
existing `tron <url>` / `tron open <url>` usage is unchanged.

## How it works

- The `tron` dispatcher routes `browser`/`open` to `tron-session`, a POSIX-sh
  engine shipped next to the launcher shim.
- `launch` starts the shim with `TRON_AUTOMATION_PORT` set. The shim adds
  `--remote-debugging-port` (and `--headless=new` when asked). Port `0` lets
  Chromium pick a free loopback port, which it records in
  `<profile>/DevToolsActivePort`.
- The engine waits for the DevTools endpoint, then writes a **session
  descriptor** to `~/.tronbrowser/automation/session.json`
  (`$TRONBROWSER_DATA/automation/…`). It records the pid, port, profile, and the
  browser-level `webSocketDebuggerUrl` — the attach point programmatic tooling
  uses from M3.2 onward.
- `status`/`tabs`/`use`/`current`/`open`/`close` drive the session through the
  DevTools HTTP endpoints (`/json/version`, `/json/list`, `/json/new`,
  `/json/activate`, `/json/close`) — no WebSocket or extra dependency is needed
  for M3.1.

## Profiles

- Headed default → a persistent `…/.tronbrowser-agent` profile, isolated from
  your day-to-day `~/.tronbrowser` browsing.
- `--headless` (no `--profile`) → an **ephemeral** temp profile, removed on
  `close`.
- `--profile <name>` → a persistent `…/.tronbrowser-<name>` profile.
- `--profile ephemeral` → an ephemeral temp profile.

## Security

- The DevTools endpoint binds to `127.0.0.1` only — never exposed off-host.
- The descriptor lives under the stable data dir, not inside an ephemeral
  profile, so `status`/`close` always find the session.

## Scope / limitations

- Requires `curl` and `python3` (already used by the launcher and Tor helper).
- Linux (native/flatpak) is the primary target; macOS headed launches via
  `open` work, but the detached process model means headless and pid-based
  liveness are best-effort there. Windows managed sessions are out of scope for
  M3.1.
- The portable schema and CDP tab-mapping contract this engine mirrors live (and
  are unit-tested) in `packages/browser-core/src/automation`.
