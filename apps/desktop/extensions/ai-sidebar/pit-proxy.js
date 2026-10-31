// Moshpit ("the pit") session routing — what the 🤘 Pit toggle installs.
//
// Moshpit endings (.eggs, .moshpit, .yeah, …) live outside the ICANN root, so
// the system resolver has no answer for them. `moshcode dns enable` teaches the
// whole machine, but needs root. This is the no-root, this-browser-only route,
// built like the Tor toggle: the launcher's helper runs a loopback SOCKS5
// resolver (tron-tor-helper, /pit/*) that answers through the Moshpit
// DNS-over-HTTPS resolver, and the extension points a PAC script at it.
//
// W3BS names go through the W3BS-first resolver while Pit is on, even if public
// DNS has a stale answer. Other names the system resolver can answer stay
// DIRECT; unresolved names use Moshpit as the backfill. Pure functions.

/** Loopback port the helper's pit resolver listens on (tron-tor-helper PIT_SOCKS_PORT). */
export const PIT_SOCKS_PORT = 9081;

function checkPort(port) {
  const p = Number(port);
  if (!Number.isInteger(p) || p <= 0 || p > 65535) throw new Error(`bad pit port: ${port}`);
  return p;
}

/**
 * The PAC script. Kept to plain ES3-style JavaScript: Chromium evaluates it in
 * its own PAC sandbox, where only the PAC helpers (dnsResolve, …) exist.
 */
export function buildPitPac(port = PIT_SOCKS_PORT) {
  const p = checkPort(port);
  return [
    'function FindProxyForURL(url, host) {',
    "  var h = String(host || '').toLowerCase();",
    "  if (h.charAt(h.length - 1) === '.') h = h.slice(0, -1);",
    // Loopback, single-label intranet names and IP literals never touch the pit.
    "  if (!h || h === 'localhost' || h.indexOf('.') === -1) return 'DIRECT';",
    "  if (h.slice(-10) === '.localhost') return 'DIRECT';",
    "  if (/^[0-9.]+$/.test(h) || h.indexOf(':') !== -1) return 'DIRECT';",
    // W3BS Net is the primary namespace for its two-label names. Its DoH
    // resolver falls through to public DNS when W3BS has no matching record.
    "  var suffix = '.w3bs.org';",
    "  var w3bsName = h.slice(-suffix.length) === suffix ? h.slice(0, -suffix.length) : '';",
    `  if (w3bsName && w3bsName.split('.').length === 2) return 'SOCKS5 127.0.0.1:${p}';`,
    // For all remaining names, ordinary DNS wins and Moshpit backfills misses.
    "  if (dnsResolve(h)) return 'DIRECT';",
    `  return 'SOCKS5 127.0.0.1:${p}';`,
    '}',
  ].join('\n');
}

/** chrome.proxy.settings value for the pit route. */
export function pitProxyConfig(port = PIT_SOCKS_PORT) {
  // Not `mandatory`: if the PAC ever fails to evaluate, Chromium falls back to
  // DIRECT and ordinary browsing keeps working — a pit name failing is the
  // acceptable failure, every site failing is not.
  return { mode: 'pac_script', pacScript: { data: buildPitPac(port) } };
}
