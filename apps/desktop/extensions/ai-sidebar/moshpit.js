// Moshpit name resolution for the extension.
//
// The policy here is a straight port of apps/desktop/src/moshpit-resolve.ts —
// same names, same semantics — because the extension is plain JS with no build
// step and cannot import the launcher's TypeScript. The TS module stays the
// reference implementation and keeps the exhaustive unit tests; this file is
// what actually runs in the browser. Keep them in sync.
//
// See that module's header for why 'clearnet' is the default: silently
// redirecting a domain that resolves perfectly well is indistinguishable from
// hijacking it.

export const DEFAULT_REGISTRY_BASE = 'https://pit.moshcode.sh';
export const DEFAULT_CONSOLE_BASE = 'https://app.moshcode.sh';

// The one label meaning "manage this namespace" rather than "visit a name".
// Reserved, not claimable — otherwise whoever holds `.eggs` could register
// `mosh.eggs` and own the page people use to check who holds `.eggs`.
export const CONSOLE_LABEL = 'mosh';

// Where a name with no destination yet is parked. A name inside the namespace
// should never dead-end on ERR_NAME_NOT_RESOLVED.
export const DEFAULT_PARKING_BASE = 'https://moshcoding.com';

/** The parking page for a name with no destination yet. */
export function parkingUrlFor(name, parkingBase = DEFAULT_PARKING_BASE) {
  return `${parkingBase.replace(/\/+$/, '')}/parking?name=${encodeURIComponent(name)}`;
}

/**
 * How long a registry lookup may take before navigation gives up on it.
 *
 * This sits in front of navigation, so it is a budget rather than a guess at
 * the worst case: exceeding it falls back to clearnet, which is the right
 * answer for a registry that is down but the wrong one for a registry that was
 * merely slow. 4s was tight for a phone on a bad connection and hopeless for
 * anything routed through Tor.
 */
export const DEFAULT_LOOKUP_TIMEOUT_MS = 8000;

/**
 * The hosts that must not be routed through Tor.
 *
 * Resolution asks the registry a question before every Moshpit navigation, and
 * a cold Tor circuit does not answer inside the lookup budget — so with Tor on
 * and no bypass, real Moshpit names quietly resolve as ordinary clearnet ones
 * and the namespace appears not to work.
 *
 * The trade is deliberate and worth stating: bypassing means the network path
 * sees which Moshpit names are being looked up, and the registry sees the real
 * IP. Neither was hidden before — the registry is told the name either way, and
 * the console is where the account is signed in — so what Tor protected on this
 * leg was close to nothing, at the cost of the feature working at all.
 *
 * Built from the configured bases rather than hardcoded, so a self-hosted pit
 * gets the same treatment as the public one.
 */
export function moshpitBypassHosts(config) {
  const hosts = [];
  for (const base of [config?.registryBase, config?.consoleBase, config?.parkingBase]) {
    if (!base) continue;
    try {
      const { hostname } = new URL(base);
      if (hostname && !hosts.includes(hostname)) hosts.push(hostname);
    } catch { /* an unparseable base is simply not bypassed */ }
  }
  return hosts;
}

/** Read the settings the options page writes. */
export async function moshpitConfig() {
  const { moshpitConfig: cfg } = await chrome.storage.local.get('moshpitConfig');
  return {
    mode: cfg?.mode === 'moshpit' ? 'moshpit' : 'clearnet',
    registryBase: (cfg?.registryBase || DEFAULT_REGISTRY_BASE).replace(/\/+$/, ''),
    consoleBase: (cfg?.consoleBase || DEFAULT_CONSOLE_BASE).replace(/\/+$/, ''),
    parkingBase: (cfg?.parkingBase || DEFAULT_PARKING_BASE).replace(/\/+$/, ''),
  };
}

/**
 * Split a hostname the way the registry does: exactly one label and one TLD.
 * Anything else (`a.b.c`, a bare `localhost`, an IP) is not a Moshpit name and
 * must never be sent to the registry as if it were.
 */
export function parseRegistryName(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.includes(':')) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split('.');
  if (parts.length !== 2) return null;
  const [label, tld] = parts;
  const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (!LABEL.test(label) || !LABEL.test(tld)) return null;
  return { label, tld };
}

/** The Pit URL for a `mosh.<tld>` hostname, or null when it isn't one. */
export function consoleUrlFor(hostname, consoleBase = DEFAULT_CONSOLE_BASE) {
  const parsed = parseRegistryName(hostname);
  if (!parsed || parsed.label !== CONSOLE_LABEL) return null;
  return `${consoleBase.replace(/\/+$/, '')}/pit?tld=${encodeURIComponent(parsed.tld)}`;
}

/** The URL that serves a resolved Moshpit name through the gateway. */
export function gatewayUrlFor(resolved, registryBase = DEFAULT_REGISTRY_BASE) {
  return `${registryBase.replace(/\/+$/, '')}/n/${encodeURIComponent(resolved)}`;
}

/**
 * Ask the registry about a name. Any failure returns null rather than throwing:
 * resolution sits in front of every navigation, so a registry that is slow,
 * down, or serving nonsense must degrade to "clearnet as usual".
 */
export async function lookupMoshpit(hostname, { registryBase, timeoutMs = DEFAULT_LOOKUP_TIMEOUT_MS } = {}) {
  const parsed = parseRegistryName(hostname);
  if (!parsed) return null;
  const base = (registryBase || DEFAULT_REGISTRY_BASE).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const name = `${parsed.label}.${parsed.tld}`;
    const res = await fetch(`${base}/api/moshpit/resolve?name=${encodeURIComponent(name)}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    // `registered` means the TLD is claimed; `name_registered` means THIS name
    // is. `target` is the address — null until the name points somewhere, which
    // is what decides parked vs live. `resolved` echoes the name either way.
    const claimed = typeof json?.name_registered === 'boolean' ? json.name_registered : json?.registered;
    if (typeof claimed !== 'boolean') return null;
    return {
      registered: claimed,
      resolved: typeof json.resolved === 'string' ? json.resolved : name,
      target: typeof json.target === 'string' && json.target ? json.target : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decide which namespace a hostname belongs to. Pure and total: every branch
 * returns a decision with a reason, so the caller never has to invent
 * behaviour for an unhandled combination.
 */
export function decideResolution({ hostname, mode, clearnetResolves, moshpit, consoleBase, parkingBase }) {
  // `mosh.<tld>` is the registration console for `.<tld>`, not a name to fetch.
  // It obeys the SAME precedence as any other Moshpit answer rather than taking
  // an exemption — `mosh.org` and `mosh.com` are real clearnet domains.
  const consoleUrl = consoleUrlFor(hostname, consoleBase);
  if (consoleUrl) {
    if (mode === 'clearnet' && clearnetResolves) {
      return { use: 'clearnet', reason: 'clearnet answers for this name (Moshpit set to backfill only)' };
    }
    const tld = parseRegistryName(hostname)?.tld;
    return {
      use: 'register',
      reason: `${CONSOLE_LABEL}.${tld} is the registration console for .${tld}`,
      url: consoleUrl,
    };
  }

  // A registry outage must not take the ordinary web down with it — nor lie
  // with a parking page for a name it simply failed to look up.
  if (!moshpit) {
    return { use: 'clearnet', reason: 'Moshpit registry not consulted or unreachable' };
  }

  // Claimed AND pointed somewhere — the precedence rules apply to it.
  if (moshpit.registered && moshpit.target) {
    if (mode === 'moshpit') {
      return {
        use: 'moshpit',
        reason: clearnetResolves
          ? 'registered in Moshpit — overriding the clearnet domain'
          : 'registered in Moshpit',
        resolved: moshpit.resolved,
      };
    }
    if (clearnetResolves) {
      return { use: 'clearnet', reason: 'clearnet answers for this name (Moshpit set to backfill only)' };
    }
    return {
      use: 'moshpit',
      reason: 'clearnet has no answer — resolved through Moshpit',
      resolved: moshpit.resolved,
    };
  }

  // Unclaimed, or claimed but not pointed at an address yet — park it, so
  // `california.oranges` explains itself instead of looking broken. Only ever
  // where clearnet has nothing.
  if (!clearnetResolves && parseRegistryName(hostname)) {
    return {
      use: 'park',
      reason: moshpit.registered
        ? 'registered in Moshpit but not pointed at an address yet'
        : 'unclaimed Moshpit name — parked',
      url: parkingUrlFor(String(hostname).trim().toLowerCase().replace(/\.$/, ''), parkingBase),
    };
  }
  if (clearnetResolves) {
    return {
      use: 'clearnet',
      reason: moshpit.registered
        ? 'registered in Moshpit but not pointed anywhere yet'
        : 'not registered in Moshpit',
    };
  }
  return { use: 'clearnet', reason: 'not a Moshpit name' };
}

/**
 * The whole policy for one navigation, as a URL to send the tab to (or null to
 * leave it alone). `clearnetResolves` is supplied by the caller because only it
 * knows whether DNS actually answered.
 */
export async function destinationFor(hostname, clearnetResolves) {
  if (!parseRegistryName(hostname)) return null;
  const { mode, registryBase, consoleBase, parkingBase } = await moshpitConfig();

  // Skip the registry round-trip entirely for the console label — it is
  // reserved, so no lookup can change the answer.
  const isConsole = !!consoleUrlFor(hostname, consoleBase);
  const moshpit = isConsole ? null : await lookupMoshpit(hostname, { registryBase });

  const decision = decideResolution({ hostname, mode, clearnetResolves, moshpit, consoleBase, parkingBase });
  if (decision.use === 'register' || decision.use === 'park') return decision.url;
  if (decision.use === 'moshpit') return gatewayUrlFor(decision.resolved, registryBase);
  return null;
}
