# Tor / .onion Mode

**Status:** design + initial implementation (v0.3.0)
**Owner:** desktop (`apps/desktop`)
**Scope:** convenience Tor routing — **not** Tor-Browser-grade anonymity.

---

## What this is

A `--tor` mode for TronBrowser that:

1. Starts a local **Tor** daemon (SOCKS5 on `127.0.0.1:9050`).
2. Launches the browser with all traffic routed through it (so `.onion` sites
   resolve and your IP is hidden from sites/ISP at the network layer).
3. Uses a **separate, wiped profile** for the Tor session — so clearnet cookies
   never ride over Tor, and nothing lasts on disk after you close it.

```bash
tron --tor                      # open a Tor window (new-tab page)
tron --tor http://example.onion # open an onion site through Tor
```

`--tor` requires the Tor daemon (`tor`) to be installed (or bundled — see
[Distribution](#distribution-follow-up-not-in-v030)); the launcher prints
install instructions if it's missing.

> **Profile note:** the launcher shim uses a dedicated, wiped profile dir rather
> than `--incognito`, because command-line `--load-extension` extensions don't
> run in incognito windows (which would break the de-googled new-tab + AI
> sidebar). The library layer (`launchWithTor`) still uses `--incognito` for the
> future native fork, where extensions can be allowed in incognito. Both deliver
> "no lasting local trace + isolated from your clearnet session."

## What this is NOT — read this first

**Tor Browser is much safer. This is just a convenience feature in `tron`.**

This gives you **network-level** privacy: it hides *where you're coming from* and
lets you reach hidden services. It does **not** make you anonymous against a
determined adversary, because Chromium still exposes a large browser
**fingerprinting** surface (canvas/font/WebGL/timing/etc.) that we do **not**
harden the way Tor Browser does.

> **If your safety, freedom, or livelihood depends on not being identified, use
> the real [Tor Browser](https://www.torproject.org/) — not this.** TronBrowser's
> `--tor` is for convenience and curiosity (reach `.onion`, hide your IP, leave
> no local trace) in your everyday browser. Any UI surfacing it must say so
> plainly.

See [`why-not-tor-browser`](#why-not-tor-browser-grade) below for the reasoning.

## Threat model

| Adversary / goal | Covered? | Notes |
| --- | --- | --- |
| Site learns your real IP | ✅ | Traffic exits via the Tor network. `.onion` never sees your IP by design. |
| ISP sees which sites you visit | ✅ | ISP sees "connected to Tor," not the destination. |
| Reach `.onion` hidden services | ✅ | Only resolvable through Tor; works once routed. |
| Local traces on this machine | ✅ | Dedicated profile, wiped on launch — nothing persists after close. |
| Clearnet ↔ Tor session linkage (shared cookies) | ✅ | Separate profile, so clearnet cookies/history never ride over Tor. |
| DNS leak (name resolved outside Tor) | ✅ | DNS is proxied through the SOCKS5 server (remote DNS), never resolved locally. |
| WebRTC IP leak (UDP around the proxy) | ✅ | `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`. |
| Browser fingerprinting / cross-site correlation | ❌ | Chromium surface not hardened. **Use Tor Browser.** |
| Malicious JS / browser exploits de-anonymizing you | ❌ | No security-slider / NoScript equivalent. **Use Tor Browser.** |

## Design

Two layers, mirroring the existing split (pure, testable flag data vs. isolated
desktop process glue):

### 1. Launch flags — `apps/desktop/src/chromium-flags.ts`

Two new `LaunchOptions`:

- `tor?: boolean` — when true, appends `TOR_FLAGS`.
- `incognito?: boolean` — when true, appends `--incognito`. **Tor implies
  incognito** unless the caller explicitly passes `incognito: false` (escape
  hatch; discouraged).

`TOR_FLAGS`:

```
--proxy-server=socks5://127.0.0.1:9050
--proxy-bypass-list=<-loopback>          # don't bypass anything; force all through Tor
--force-webrtc-ip-handling-policy=disable_non_proxied_udp
```

DNS note: Chromium's SOCKS5 proxy performs **remote** DNS resolution (it hands
the hostname to the proxy), so names — including `.onion` — are resolved inside
Tor, not on the local resolver. No `--host-resolver-rules` hack needed.

The existing `FORBIDDEN_FLAG_SUBSTRINGS` audit still runs over the full list.

### 2. Tor daemon — `apps/desktop/src/tor.ts`

Pure, unit-tested helpers:

- `resolveTorBinary(opts)` — prefer a bundled `tor` shipped next to the browser
  binary, else fall back to a `tor` on `PATH`. Per-platform name (`tor` /
  `tor.exe`), mirroring `binary.ts`.
- `buildTorArgs(opts)` — builds the `tor` CLI args (`--SocksPort`,
  `--DataDirectory`, optional `--ControlPort`), pure data.
- `parseBootstrapProgress(line)` — parses `Bootstrapped NN% (...)` log lines into
  a `0..100` number (or `null`), so we can show progress and know when Tor is
  ready.

Process glue (thin, not heavily unit-tested):

- `class TorDaemon` — `start()` spawns `tor`, watches stdout for
  `Bootstrapped 100%`, resolves when ready (with a timeout), and `stop()` kills
  it. The browser is only launched **after** bootstrap completes, so the first
  request never races a half-open circuit.

### 3. Launcher — `apps/desktop/src/launcher.ts` (library)

`launch()` gains an optional Tor path: when `config.tor` is set, start a
`TorDaemon`, await bootstrap, then spawn the browser with Tor flags, and tear the
daemon down when the browser exits.

### 4. CLI shim — `apps/desktop/launcher/tronbrowser` (what actually runs today)

The real runtime today is the POSIX `sh` launcher shim, not the TS library
(which targets the future native fork). It implements `--tor` directly:

- Parse `--tor` out of the args (rest pass through as URLs).
- Resolve `tor`: a bundled `$DIR/tor` first, else one on `PATH`; clear install
  message if missing.
- Point the browser at a **separate, wiped profile** (`<data>-tor`) so the Tor
  session is isolated from the clearnet profile; the daemon's own state lives
  under `<data>/tor`.
- Start `tor --SocksPort 127.0.0.1:9050 --DataDirectory …`, poll its log for
  `Bootstrapped 100%` (60s timeout, bail if it dies), then add the proxy flags.
- Do **not** `exec` in Tor mode — keep the shell alive so an `EXIT/INT/TERM`
  trap stops the daemon when the browser closes. (macOS `open` detaches, so
  there the trap is disarmed and the user is told the Tor pid to kill.)

Usage:

```bash
tron --tor                      # Tor window, de-googled new-tab
tron --tor http://example.onion # open an onion site
TRONBROWSER_TOR_PORT=9150 tron --tor   # custom SOCKS port
```

## Distribution (follow-up, not in v0.3.0)

To make `--tor` work out of the box, each target in `distribution/` must ship or
depend on a `tor` binary:

- **deb/rpm:** `Depends/Requires: tor`.
- **AppImage / Flatpak / Snap / macOS / Windows:** bundle a static `tor` next to
  the browser binary (resolved by `resolveTorBinary`).
- **Homebrew/AUR/Nix/etc.:** declare `tor` as a dependency.

Until then, `--tor` requires a system `tor` on `PATH` and surfaces a clear error
if missing.

## Why not Tor-Browser-grade?

Tor Browser is a hardened **Firefox** fork plus years of anti-fingerprinting work
(letterboxing, canvas/font/WebGL/timing resistance, first-party isolation,
disabled APIs) maintained by a dedicated team. Replicating that on **Chromium**
is a months-long, never-finished effort, and we'd still be weaker than the real
thing. The Tor Project explicitly discourages Tor-over-Chromium for anonymity.
So we ship the genuinely-useful network layer and are honest about the ceiling.

## Future work

- Tor toggle + bootstrap/circuit indicator in the AI sidebar/settings UI.
- Bundle `tor` across `distribution/` targets (see above).
- "New circuit for this site" action.
- Detect and warn when the user navigates to a clearnet site that's likely to
  fingerprint them.
