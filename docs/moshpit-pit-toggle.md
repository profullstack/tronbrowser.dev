# 🤘 Pit toggle — Moshpit names for one browser session

**Status:** shipped with the AI-sidebar extension + `tron-tor-helper` 3.3.0
**Owner:** desktop (`apps/desktop`)
**Scope:** resolve Moshpit names in the running browser with one click. Not a
replacement for `moshcode dns enable`, which does it for the whole machine.

---

## What it is

Moshpit endings (`.eggs`, `.moshpit`, `.yeah`, thousands more) live outside the
ICANN root, so the system resolver has nowhere to look them up. There are two
ways to make them work, and the settings page says so:

| | `moshcode dns enable` | 🤘 Pit toggle |
| --- | --- | --- |
| Scope | every application on the machine | this browser session |
| Needs root | yes (rewrites the resolver config, installs a local CA) | no |
| Survives restart | yes | no — off again on every launch, like 🧅 Tor |
| `https://` on a pit name | works (pinned proxy + local CA) | warns, unless `moshcode dns enable` has installed the CA |
| Clearnet names | forwarded to public resolvers | never touched |

The toggle is for the laptop where DNS is not yours to change, or the first
five minutes before you have run `moshcode dns enable`.

## How it works

It is built exactly like the 🧅 Tor toggle:

1. **The helper.** The launcher already runs a loopback control helper
   (`apps/desktop/launcher/tron-tor-helper`, `127.0.0.1:9061`) at every browser
   launch. It now also serves `/pit/start`, `/pit/stop` and `/pit/status`.
   `/pit/start` binds a **SOCKS5 resolver on `127.0.0.1:9081`** and probes the
   Moshpit DNS-over-HTTPS resolver (`https://dns.moshcode.sh/dns-query`) with
   `mosh.eggs`, a name the registry reserves, so the toggle can say whether names
   will actually resolve and not merely that a port is open. Like Tor, **nothing
   listens and nothing is contacted until the toggle asks**.
2. **The resolver.** For each `CONNECT`, the SOCKS server asks the DoH resolver
   for the name's A records (RFC 8484 GET, answers cached for their TTL, negatives
   for 30 s), falls back to the system resolver if that fails, connects to the
   answer and relays bytes. TLS passes through untouched. Only `CONNECT` over TCP
   is implemented; the browser never asks a SOCKS proxy for UDP.
3. **The PAC.** The extension (`apps/desktop/extensions/ai-sidebar/pit-proxy.js`)
   installs a `pac_script` proxy config whose `FindProxyForURL` calls
   `dnsResolve(host)`. **Anything the system resolver can answer goes `DIRECT`,
   untouched.** Only a host it has no answer for is sent to the pit resolver.
   Loopback, single-label intranet names and IP literals always go `DIRECT`.

That last rule is the point. Real TLDs (`.io`, `.dev`, `.sh`, …) have been
claimed as Moshpit endings too, so an ending list cannot say whether a host is a
Moshpit name. The house policy is **clearnet wins, the pit is the fallback**: a
resolver that silently redirected a domain which already works would be
indistinguishable from a hijack. `dnsResolve` applies that policy per host with
no ending list to fetch, cache or age out.

The PAC is not `mandatory`: if it ever fails to evaluate, Chromium falls back to
`DIRECT` and ordinary browsing keeps working.

## Tor and the pit are exclusive

The pit's PAC asks the **system** resolver about every host. With Tor on, that
would leak every lookup outside Tor, so:

- turning 🧅 Tor on takes the pit down first (the background does it, the
  sidebar refreshes the button);
- turning 🤘 Pit on while Tor is on is refused with a plain-language reason.

## What you see

- The button reads **🤘 Pit ON** in moshcode's acid green, the toolbar icon gets
  a **PIT** badge, and the status strip shows the probe:
  `Pit is on — Moshpit names resolve in this session (mosh.eggs → 67.205.189.229)`.
- Test it by opening `http://mosh.eggs` — the Pit's own front door for `.eggs`.
- If the DoH resolver did not answer the probe (offline, slow), the pit stays
  **on** and says so; names resolve as soon as it is reachable.
- Failures the sidebar explains: the helper is not running (`tron upgrade`,
  restart), port 9081 is taken, Tor is on.

## Files

| File | Role |
| --- | --- |
| `apps/desktop/launcher/tron-tor-helper` | `/pit/*` routes, the SOCKS5 resolver, the DoH client |
| `apps/desktop/launcher/tronbrowser` | starts the helper; `HELPER_VERSION` must match the helper's so a stale one is replaced |
| `apps/desktop/extensions/ai-sidebar/pit-proxy.js` | the PAC + proxy config (pure, tested in `pit-proxy.test.js`) |
| `apps/desktop/extensions/ai-sidebar/background.js` | `pit-set` / `pit-status` messages, badge, session-scoped state |
| `apps/desktop/extensions/ai-sidebar/sidepanel.*` | the button and its status copy |

Environment knobs on the helper: `TRON_PIT_SOCKS_PORT` (9081),
`TRON_PIT_DOH_URL`, `TRON_PIT_PROBE_NAME`.

## Testing the helper by hand

```sh
TRON_TOR_HELPER_PORT=19061 TRON_PIT_SOCKS_PORT=19081 python3 apps/desktop/launcher/tron-tor-helper &
curl -X POST http://127.0.0.1:19061/pit/start
curl --socks5-hostname 127.0.0.1:19081 -I http://mosh.eggs/      # 302 → pit.moshcode.sh
curl --socks5-hostname 127.0.0.1:19081 -I https://example.com/   # clearnet relays too
curl -X POST http://127.0.0.1:19061/pit/stop
```

## Not in this version

- **`https://` on pit names without the CA.** The pit page documents it: no
  public CA issues for a namespace outside the ICANN root. `moshcode dns enable`
  installs the Moshpit CA and the launcher mirrors it into Chromium's trust
  store on every start, so the two features compose.
- **"Moshpit wins."** The resolvers' `MOSHPIT_RESOLVE_MODE=moshpit` lets a
  registered name override a clearnet one. The toggle only implements the
  default `fallback` policy.
- **Persisting across launches.** Mirrors Tor deliberately; a setting to keep
  the pit on would be a small follow-up.
- **Windows.** The `.cmd` shim does not start the helper, so neither toggle
  works there yet.
