# 🤘 Pit toggle — Moshpit names for one browser session

**Status:** AI-sidebar extension + `tron-tor-helper` 3.4.4
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

**Since 2026-09-16 the registry signs.** pit.moshcode.sh runs a certificate
authority for the names it holds (moshcode `apps/pwa/docs/moshpit-ca.md`):
one root, 30-day leaves per name issued to whoever controls the name. The
installer fetches that root on install and on `tron upgrade`
(`ensure_moshpit_root`, checked against the fingerprint the registry reports),
keeps it next to the launcher as `moshpit-root-ca.crt`, and the launcher
imports it into the browser's trust store on every start under the nickname
`Moshpit Root CA`, the same one `moshcode dns enable` uses. Once origins serve
registry-signed chains, that root is all a browser needs; the per-name import
below stays for origins that still self-sign and is otherwise idle.

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

Chromium opens one of two databases per home: the legacy `~/.pki/nssdb`, or
since M146 `${XDG_DATA_HOME:-~/.local/share}/pki/nssdb`, and which one a build
picks has changed between versions. A Flatpak engine is sandboxed with
`--persist=.pki` and `XDG_DATA_HOME=~/.var/app/<app>/data`, so its two
candidates are `~/.var/app/<app>/.pki/nssdb` and
`~/.var/app/<app>/data/pki/nssdb`, and the real `~/.pki` is invisible to it.
The helper and the launcher's Local CA sync therefore write every candidate
that already exists for each home (the real one, the engine's, and any
`~/.var/app/*chromium*`), and create the legacy one only when none exists,
so a browser is never flipped onto a fresh empty store. Found on bonita:
Flatpak ungoogled-chromium 152 read `data/pki/nssdb` while `.pki/nssdb`
existed beside it, and Chromium's net log said "No matching issuer found"
until that database held the leaf too.

**The Flathub ungoogled-chromium does not honour NSS user trust at all.** Found
on bonita with 152.0.7977.82-1: `strace` showed Chromium opening the very
database that held the leaf (peer and anchor trust both tried), single-process
and no-sandbox made no difference, and its net log still said "No matching
issuer found". The same 152 release as a portable build accepts the same
database in every variant tried. So TronBrowser now ships its own engine:
`install.sh ensure_engine` fetches the pinned portable ungoogled-chromium into
`<launcher dir>/engine/` next to Tor and Obscura, on install and on
`tron upgrade`, and the launcher prefers `$DIR/engine/chrome` over any system
or Flatpak Chromium (after a `--version` probe, so a machine missing a shared
library falls back rather than failing to start). On that engine the per-name
import above is all that is needed: no flag, no bar, no relaunch. If the pit
is turned on while a Flatpak engine is still running, the sidebar says so and
points at `tron upgrade`.

Two things the engine needs to actually start. Ubuntu 23.10+ sets
`kernel.apparmor_restrict_unprivileged_userns=1`, which blocks the user
namespaces Chromium's sandbox needs; without help the engine aborts in
`ZygoteHostImpl::Init` ("No usable sandbox!", SIGTRAP), which is what bonita
hit first. Ubuntu's answer for third-party browsers is an AppArmor profile
granting `userns` to the binary path (Chromium's
`docs/security/apparmor-userns-restrictions.md`), so `install.sh` writes
`/etc/apparmor.d/tronbrowser-engine` once, with one `sudo`, and loads it.
And the launcher never takes the engine on faith: `engine_usable` runs a
throwaway headless start once per engine version, remembers success in
`engine/.usable`, and on failure falls through to a system or Flatpak
Chromium with a note saying why. A missing library or a missing profile is a
fallback, never a crash. A `--ignore-certificate-errors-spki-list` workaround
was tried and reverted: it works, but Chromium flags it as an unsupported switch
at every start.

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

- **Per-name HTTPS trust on macOS and Windows.** Per-name trust writes the NSS
  database, which only Chromium on Linux reads. Windows can explicitly opt into
  registry-root trust using the setup below. This does not trust self-signed
  origins, and macOS trust setup remains unchanged.
- **"Moshpit wins."** The resolvers' `MOSHPIT_RESOLVE_MODE=moshpit` lets a
  registered name override a clearnet one. The toggle only implements the
  default `fallback` policy.
- **Persisting across launches.** Mirrors Tor deliberately; a setting to keep
  the pit on would be a small follow-up.

## Windows launcher and HTTPS

Extract the **complete Windows release ZIP** and run `tronbrowser.cmd`. Loading
only the extension into a portable browser cannot start the helper. Install
Python 3.9+ (3.12 or newer recommended) from python.org first. The launcher checks
`python/python.exe` beside the launcher, then `py -3`, then Python on PATH; it
does not download an interpreter. Set `TRONBROWSER_BROWSER` to your Ungoogled
Chromium executable if it is not in a standard install location.

The launcher starts the bundled `tron-tor-helper` on loopback and waits for a
bounded readiness check before opening the browser. It does not enable Pit or
Tor, change DNS, or install certificates. A failed helper cannot prevent ordinary
browsing; details are in `%USERPROFILE%\.tronbrowser\tor-helper.log` (or the
`TRONBROWSER_DATA` directory). A compatible existing helper is reused. An unknown
service or stale helper is never killed by PID; restart Windows after upgrading
if a stale helper is still running. Like the Linux helper, it can outlive the
browser, while the extension's proxy selection resets each browser session.

For **registry-signed HTTPS** there is a separate opt-in command:

```bat
tronbrowser.cmd --setup-pit-https
```

This command fetches the CA over verified HTTPS, checks both registry metadata
and the root SHA-256 pinned in the release, validates its CA constraints, key
usage and dates with Windows, and requires typing `TRUST` before adding it to
**Current User / Trusted Root Certification Authorities**. It never changes
Local Machine roots or DNS and never disables TLS verification. A root rotation
requires a reviewed code update, not just new metadata from the registry.

**Trust boundary:** this root is unconstrained. It can vouch for arbitrary DNS
names in **all apps that use this Windows user store**, not only Moshpit names or
TronBrowser. The certificate remains installed when Pit is off. Do not approve
it on a managed/company machine without administrator authorization. Cancel the
prompt if that trust is not acceptable; HTTP Pit routing remains usable and
HTTPS certificate warnings remain in place. Never bypass those warnings.

After setup, fully restart TronBrowser and enable Pit. HTTPS still requires a
valid certificate for the requested hostname; an arbitrary self-signed origin
will not become trusted. To undo a newly installed root, use `certmgr.msc` and
remove only the certificate whose exact thumbprint the setup printed. The setup
does not change or claim ownership of a root that was already trusted.

Regression tests (no CA imports or public-network calls):

```sh
python -B -m unittest discover -s apps/desktop/test -p test_windows_pit.py -v
```

Run on Windows as well as Linux: the native `.cmd` argument/path test is skipped
on other systems. Real Ungoogled Chromium/Pit HTTPS acceptance still needs a
Windows machine with the intended trust policy. Automated socket/TLS tests alone
do not establish that a specific browser build honors the Windows trust store.
