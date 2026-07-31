/**
 * Moshpit name resolution, and how it coexists with clearnet DNS.
 *
 * Two namespaces now answer to the same shape of name. `profullstack.ai` is a
 * real clearnet domain someone can squat, and it is *also* a name the Moshpit
 * registry can hold. Something has to decide which one a navigation means, and
 * that decision cannot be hardcoded: a user who has never heard of Moshpit must
 * keep getting clearnet, while an operator who registered the name in Moshpit
 * expects their version to win.
 *
 * So it is a setting, with two honest positions:
 *
 *   'clearnet' (default) — clearnet owns any name clearnet can answer. Moshpit
 *       is consulted only where DNS came up empty, which makes the registry a
 *       *backfill*: it fills the gaps rather than shadowing the existing web.
 *       Chosen as the default because silently redirecting a domain that
 *       resolves perfectly well is indistinguishable from hijacking it.
 *
 *   'moshpit' — a name registered in Moshpit wins, even when clearnet has an
 *       answer for it. This is the override: the point of registering
 *       `profullstack.ai` in Moshpit is that your version is the one you get,
 *       regardless of who holds the clearnet domain.
 *
 * Names under a TLD that clearnet has never heard of (`.eggs`, `.sploof`)
 * resolve through Moshpit in either mode — there is nothing to conflict with,
 * and refusing to resolve them would defeat the entire namespace.
 */

export type ResolveMode = 'clearnet' | 'moshpit';

export const DEFAULT_RESOLVE_MODE: ResolveMode = 'clearnet';

/** The public registry. Overridable so a self-hosted pit can be pointed at. */
export const DEFAULT_REGISTRY_BASE = 'https://pit.moshcode.sh';

export interface MoshpitLookup {
  /** The registry holds this name. */
  registered: boolean;
  /** Where it actually points once aliases are followed (`foo.agent`). */
  resolved: string;
}

export interface ResolveInputs {
  hostname: string;
  mode: ResolveMode;
  /** Whether ordinary DNS has an answer. */
  clearnetResolves: boolean;
  /** Registry answer, or null when it was not consulted / was unreachable. */
  moshpit: MoshpitLookup | null;
}

export interface ResolveDecision {
  /** Which namespace serves this navigation. */
  use: 'clearnet' | 'moshpit';
  /** Why — surfaced in the UI so an override never looks like a glitch. */
  reason: string;
  /** The name to fetch through the gateway. Only set when `use` is 'moshpit'. */
  resolved?: string;
}

/**
 * Decide which namespace a hostname belongs to.
 *
 * Deliberately pure and total: every branch returns a decision with a reason,
 * so the caller never has to invent behaviour for an unhandled combination, and
 * the whole policy is testable without a network or a browser.
 */
export function decideResolution(inputs: ResolveInputs): ResolveDecision {
  const { mode, clearnetResolves, moshpit } = inputs;

  // The registry could not be reached, or was never asked. Falling back to
  // clearnet is the only safe move: a registry outage must not take the
  // ordinary web down with it.
  if (!moshpit || !moshpit.registered) {
    return {
      use: 'clearnet',
      reason: moshpit ? 'not registered in Moshpit' : 'Moshpit registry not consulted or unreachable',
    };
  }

  if (mode === 'moshpit') {
    return {
      use: 'moshpit',
      reason: clearnetResolves
        ? 'registered in Moshpit — overriding the clearnet domain'
        : 'registered in Moshpit',
      resolved: moshpit.resolved,
    };
  }

  // clearnet mode: the registry only fills gaps.
  if (clearnetResolves) {
    return { use: 'clearnet', reason: 'clearnet answers for this name (Moshpit set to backfill only)' };
  }
  return {
    use: 'moshpit',
    reason: 'clearnet has no answer — resolved through Moshpit',
    resolved: moshpit.resolved,
  };
}

/**
 * Split a hostname the way the registry does: exactly one label and one TLD.
 * Anything else (`a.b.c`, a bare `localhost`, an IP) is not a Moshpit name and
 * must never be sent to the registry as if it were.
 */
export function parseRegistryName(hostname: string): { label: string; tld: string } | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.includes(':')) return null;
  // An IPv4 literal is not a name.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split('.');
  if (parts.length !== 2) return null;
  const [label, tld] = parts;
  // `parts.length !== 2` above already guarantees both exist, but
  // noUncheckedIndexedAccess types them as `string | undefined` — TS can't
  // narrow an array to a 2-tuple from a length check. An empty label would
  // fail LABEL.test() anyway, so this guard changes no behavior.
  if (!label || !tld) return null;
  const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (!LABEL.test(label) || !LABEL.test(tld)) return null;
  return { label, tld };
}

/** The URL that serves a resolved Moshpit name through the gateway. */
export function gatewayUrlFor(resolved: string, registryBase = DEFAULT_REGISTRY_BASE): string {
  return `${registryBase.replace(/\/+$/, '')}/n/${encodeURIComponent(resolved)}`;
}

/**
 * Ask the registry about a name.
 *
 * Any failure returns null rather than throwing: resolution sits in front of
 * every navigation, so a registry that is slow, down, or serving nonsense must
 * degrade to "clearnet as usual" instead of breaking browsing.
 */
export async function lookupMoshpit(
  hostname: string,
  options: { registryBase?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<MoshpitLookup | null> {
  const parsed = parseRegistryName(hostname);
  if (!parsed) return null;

  const base = (options.registryBase ?? DEFAULT_REGISTRY_BASE).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 4000);
  try {
    const url = `${base}/api/moshpit/resolve?name=${encodeURIComponent(`${parsed.label}.${parsed.tld}`)}`;
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as { registered?: boolean; resolved?: string; name?: string };
    if (typeof json?.registered !== 'boolean') return null;
    return {
      registered: json.registered,
      resolved: typeof json.resolved === 'string' ? json.resolved : `${parsed.label}.${parsed.tld}`,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
