// Which namespace an ending belongs to.
//
// Moshpit resolution used to infer "clearnet has no answer for this name" from
// a DNS error (ERR_NAME_NOT_RESOLVED). That inference is only sound on a
// resolver that reports failure honestly, and many do not: NXDOMAIN hijacking
// resolvers answer EVERY nonexistent name with a wildcard ad host. On such a
// connection `blue.eggs` resolves, the error never fires, and every Moshpit
// name lands on the hijacker's page — indistinguishable from the namespace not
// working, and unfixable from inside the browser as long as DNS is the signal.
//
// The ending is a better signal, and it is one we hold locally: clearnet can
// only ever answer for an ending that actually exists on the real internet.
// `.eggs` is not in IANA's list and never will be by accident, so a resolver
// that answers for `blue.eggs` is lying no matter what it returns. That makes
// the decision independent of the network the user happens to be on.
import { IANA_TLDS, IANA_TLD_VERSION } from './tld-data.js';

export { IANA_TLD_VERSION };

const ICANN = new Set(IANA_TLDS);

/**
 * Endings that are neither ICANN's nor Moshpit's.
 *
 * These resolve outside ordinary DNS, so they fail the "is it in IANA's list"
 * test and would otherwise be treated as Moshpit names. Each one would break
 * something real:
 *
 *   onion — the big one. A v3 address is 56 alphanumeric characters plus
 *     `.onion`: exactly two labels, letters and digits only, so it satisfies
 *     parseRegistryName and would be sent to the registry before every Tor
 *     navigation. The pit's hosts deliberately bypass the SOCKS proxy, so that
 *     lookup would leave over clearnet carrying the onion address being
 *     visited — a deanonymization leak, not merely a wasted request.
 *
 *   local / localhost / test / invalid / example — reserved by RFC 6761 for
 *     mDNS, loopback, testing and documentation.
 *
 *   internal / home / lan / corp / intranet / alt — the private-use endings
 *     people actually put on home routers and office networks (`.internal` and
 *     `.alt` are the standardized ones; the rest are long-standing practice).
 *
 * A Moshpit ending will never be one of these, because the registry cannot
 * hand out an ending that resolvers already treat as special.
 */
export const RESERVED_TLDS = new Set([
  'onion',
  'local', 'localhost', 'test', 'invalid', 'example',
  'internal', 'alt', 'home', 'lan', 'corp', 'intranet',
]);

/** The ending of a hostname, lowercased and de-rooted. '' when there isn't one. */
export function tldOf(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.includes(':')) return '';
  const i = host.lastIndexOf('.');
  return i === -1 ? '' : host.slice(i + 1);
}

/** Does this ending exist on the real internet? */
export function isIcannTld(tld) {
  return ICANN.has(String(tld || '').trim().toLowerCase());
}

/** Is this ending reserved for something that is neither clearnet nor Moshpit? */
export function isReservedTld(tld) {
  return RESERVED_TLDS.has(String(tld || '').trim().toLowerCase());
}

/**
 * Could clearnet legitimately answer for this hostname?
 *
 * True for a real ending, and — deliberately — true for a reserved one too:
 * `.onion` and `.local` are answered by something other than the Moshpit
 * registry, so as far as this policy is concerned they are already spoken for.
 * The one case that returns false is an ending nobody but Moshpit could own.
 */
export function clearnetCanAnswer(hostname) {
  const tld = tldOf(hostname);
  if (!tld) return true; // no ending at all — not ours to redirect
  return isIcannTld(tld) || isReservedTld(tld);
}

/**
 * Is this hostname in the part of the namespace only Moshpit can own?
 *
 * The caller still has to run parseRegistryName: this answers "is the ending
 * Moshpit's", not "is the whole hostname a well-formed Moshpit name".
 */
export function isMoshpitOnlyNamespace(hostname) {
  return !clearnetCanAnswer(hostname);
}

/**
 * Is this hostname answered by something that is neither clearnet nor Moshpit?
 *
 * Callers use this to drop a navigation before it reaches the registry at all,
 * in EITHER mode. For `.onion` that is not an optimization: the registry hosts
 * bypass the SOCKS proxy, so a lookup here would carry the onion address out
 * over clearnet.
 */
export function isReservedNamespace(hostname) {
  return isReservedTld(tldOf(hostname));
}
