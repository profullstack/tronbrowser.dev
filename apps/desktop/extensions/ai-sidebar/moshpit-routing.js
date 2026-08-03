// Whether a navigation is Moshpit's business, and what to tell the policy.
//
// Split out of background.js so it can be tested without standing up a service
// worker: background.js has top-level Tor and proxy work that has nothing to do
// with name resolution. What is left there is the two listeners and this call.
//
// The decision this makes used to be made by DNS — see tlds.js for why that was
// unsound on a resolver that hijacks NXDOMAIN.
import { parseRegistryName } from './moshpit.js';
import { isMoshpitOnlyNamespace, isReservedNamespace } from './tlds.js';

/**
 * Which territory a hostname is in. Total: every hostname is in exactly one.
 *
 *   'none'     — not a Moshpit-shaped hostname at all (wrong label count, an
 *                IP, a port, a dash). Never ours.
 *   'reserved' — `.onion`, `.local` and friends: answered by something that is
 *                neither clearnet nor Moshpit, and must not reach the registry
 *                in either mode.
 *   'moshpit'  — an ending only Moshpit could own. Clearnet cannot answer for
 *                it, whatever the resolver said.
 *   'clearnet' — a real ending. Ordinary browsing.
 */
export function territoryOf(hostname) {
  if (!hostname || !parseRegistryName(hostname)) return 'none';
  if (isReservedNamespace(hostname)) return 'reserved';
  if (isMoshpitOnlyNamespace(hostname)) return 'moshpit';
  return 'clearnet';
}

/**
 * What to do with a navigation we are about to let through.
 *
 * Returns `{ resolve: false, why }` to leave the tab alone, or
 * `{ resolve: true, clearnetResolves, why }` to run the Moshpit policy — where
 * `clearnetResolves` is what we know about clearnet, not what DNS claimed.
 */
export function routeForNavigation(hostname, mode) {
  switch (territoryOf(hostname)) {
    case 'none':
      return { resolve: false, why: 'not a Moshpit-shaped hostname' };
    case 'reserved':
      // .onion above all: asking the registry would carry the address out over
      // clearnet, because the pit's hosts bypass the SOCKS proxy.
      return { resolve: false, why: 'reserved ending — answered by neither clearnet nor Moshpit' };
    case 'moshpit':
      // Clearnet cannot own this ending, so whatever DNS returned for it was
      // not an answer. Both modes resolve it; neither waits for a DNS error.
      return { resolve: true, clearnetResolves: false, why: 'ending only Moshpit can own' };
    default:
      if (mode !== 'moshpit') {
        // The default mode leaves a real ending to clearnet, and — the point of
        // returning here — never spends a registry round-trip on it.
        return { resolve: false, why: 'real ending, and Moshpit is set to backfill only' };
      }
      return { resolve: true, clearnetResolves: true, why: 'moshpit mode may override a real ending' };
  }
}

/**
 * The same question for a navigation that already failed DNS.
 *
 * Only a real ending is actionable here: a Moshpit-only ending was handled
 * before the request went out, and running again on the error would race that
 * redirect.
 */
export function routeForDnsFailure(hostname) {
  switch (territoryOf(hostname)) {
    case 'clearnet':
      return { resolve: true, clearnetResolves: false, why: 'real ending, and clearnet genuinely had no answer' };
    case 'moshpit':
      return { resolve: false, why: 'already handled before the request went out' };
    case 'reserved':
      return { resolve: false, why: 'reserved ending — answered by neither clearnet nor Moshpit' };
    default:
      return { resolve: false, why: 'not a Moshpit-shaped hostname' };
  }
}
