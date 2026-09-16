# 🤘 Pit toggle — Moshpit names for one browser session

**Status:** shipped with the AI-sidebar extension + `tron-tor-helper` 3.4.1
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
| `https://` on a pit name | works (pinned proxy + local CA) | works on Linux: the leaf is trusted per name on first use, against the registry pin |
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

## HTTPS on a pit name

No public CA issues for a name outside the ICANN root, so an origin such as
`chovy.hacker` serves a self-signed leaf for its own name and the registry
publishes the SHA-256 of that key (`/api/moshpit/pins?name=`, the RFC 7469 pin
format). `moshcode dns trust <name>` installs such a leaf into the system store,
with root. The pit toggle does the no-root equivalent for this browser:

1. On the first HTTPS `CONNECT` for a name, the helper fetches the certificate
   the origin serves (without verifying it: deciding whether to trust it is the
   point), computes the pin of its key, and fetches the registry's pins.
2. The key must match a published pin, and the certificate must not be marked
   `CA:TRUE` (a CA trusted directly could vouch for any name; the same refusal
   `moshcode dns trust` makes).
3. The leaf is written to `~/.tronbrowser/pit-certs/moshpit-<name>.crt` and
   imported into `~/.pki/nssdb` as a **peer** (`certutil -t P,,`) under the
   nickname `moshpit <name>`, the same nickname the launcher's trust sync uses,
   so neither imports the other's work twice. Peer trust vouches for that one
   certificate and the name in its SAN, nothing else.
4. All of this happens before the SOCKS reply, so the browser's TLS handshake
   that follows already finds the certificate trusted.

The import goes into every database the engine might read: `~/.pki/nssdb`,
the database the launcher names for the engine it started, and any
`~/.var/app/*chromium*/.pki/nssdb`. That last part matters: the Flathub
ungoogled-chromium is sandboxed with `--persist=.pki`, so inside it `~/.pki`
is `~/.var/app/io.github.ungoogled_software.ungoogled_chromium/.pki`, and an
import into the real `~/.pki/nssdb` never reaches it (the launcher's Local CA
sync had the same blind spot and now writes both).

Linux only for now (Chromium on macOS reads the keychain, which needs an
interactive prompt), and it needs `certutil` (Debian/Ubuntu `libnss3-tools`,
Fedora `nss-tools`, Arch `nss`); `install.sh` installs it on machines that have
Moshpit certificates. The sidebar says which case applies when the pit turns on.
A name the registry publishes no pin for is left alone and the browser's own
warning stands. If a name was already opened and rejected in this session
before the pit was on, Chromium may keep that verdict cached for a while;
reopening the tab or restarting the browser clears it.

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
  restart), port 9081 is taken, Tor is on, or the helper is still an older
  version. That last one is a launch race: the launcher replaces an out-of-date
  helper in the background a moment after the browser starts, and a click in
  that window reaches the old helper's 404. The background retries `/pit/start`
  for about ten seconds before reporting it.

## Files

| File | Role |
| --- | --- |
| `apps/desktop/launcher/tron-tor-helper` | `/pit/*` routes, the SOCKS5 resolver, the DoH client, per-name leaf trust |
| `apps/desktop/launcher/tronbrowser` | starts the helper; `HELPER_VERSION` must match the helper's so a stale one is replaced |
| `apps/desktop/extensions/ai-sidebar/pit-proxy.js` | the PAC + proxy config (pure, tested in `pit-proxy.test.js`) |
| `apps/desktop/extensions/ai-sidebar/background.js` | `pit-set` / `pit-status` messages, badge, session-scoped state |
| `apps/desktop/extensions/ai-sidebar/sidepanel.*` | the button and its status copy |

Environment knobs on the helper: `TRON_PIT_SOCKS_PORT` (9081),
`TRON_PIT_DOH_URL`, `TRON_PIT_PROBE_NAME`, `TRON_PIT_REGISTRY`,
`TRON_PIT_NSSDB` (`~/.pki/nssdb`), `TRON_PIT_CERT_DIR`.

## Testing the helper by hand

```sh
TRON_TOR_HELPER_PORT=19061 TRON_PIT_SOCKS_PORT=19081 python3 apps/desktop/launcher/tron-tor-helper &
curl -X POST http://127.0.0.1:19061/pit/start
curl --socks5-hostname 127.0.0.1:19081 -I http://mosh.eggs/      # 302 → pit.moshcode.sh
curl --socks5-hostname 127.0.0.1:19081 -I https://example.com/   # clearnet relays too
curl -X POST http://127.0.0.1:19061/pit/stop
```

## Not in this version

- **`https://` on macOS and Windows.** Per-name trust writes the NSS database,
  which only Chromium on Linux reads. `moshcode dns enable` remains the answer
  there.
- **"Moshpit wins."** The resolvers' `MOSHPIT_RESOLVE_MODE=moshpit` lets a
  registered name override a clearnet one. The toggle only implements the
  default `fallback` policy.
- **Persisting across launches.** Mirrors Tor deliberately; a setting to keep
  the pit on would be a small follow-up.
- **Windows.** The `.cmd` shim does not start the helper, so neither toggle
  works there yet.
