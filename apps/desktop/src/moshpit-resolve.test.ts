import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_RESOLVE_MODE,
  decideResolution,
  gatewayUrlFor,
  lookupMoshpit,
  parseRegistryName,
  type MoshpitLookup,
  consoleUrlFor,
} from './moshpit-resolve';

const registered = (resolved: string): MoshpitLookup => ({ registered: true, resolved, target: '203.0.113.7' });
const unregistered: MoshpitLookup = { registered: false, resolved: '', target: null };
/** Claimed, but never pointed at an address — the state every name starts in. */
const unpointed = (name: string): MoshpitLookup => ({ registered: true, resolved: name, target: null });

describe('decideResolution — clearnet mode (the default)', () => {
  it('defaults to clearnet', () => {
    expect(DEFAULT_RESOLVE_MODE).toBe('clearnet');
  });

  it('leaves a working clearnet domain alone even when Moshpit holds the name', () => {
    // The squatting case, from the safe side: someone holds profullstack.ai on
    // clearnet AND we hold it in Moshpit. Default must not hijack it — silently
    // redirecting a domain that resolves is indistinguishable from a takeover.
    const d = decideResolution({
      hostname: 'profullstack.ai',
      mode: 'clearnet',
      clearnetResolves: true,
      moshpit: registered('profullstack.ai'),
    });
    expect(d.use).toBe('clearnet');
    expect(d.reason).toMatch(/backfill/i);
  });

  it('backfills a name clearnet cannot answer', () => {
    const d = decideResolution({
      hostname: 'original.sploof',
      mode: 'clearnet',
      clearnetResolves: false,
      moshpit: registered('original.sploof'),
    });
    expect(d.use).toBe('moshpit');
    expect(d.resolved).toBe('original.sploof');
  });
});

describe('decideResolution — moshpit mode (the override)', () => {
  it('overrides a live clearnet domain', () => {
    // The whole point of registering profullstack.ai in Moshpit: your version
    // wins regardless of who holds the clearnet domain.
    const d = decideResolution({
      hostname: 'profullstack.ai',
      mode: 'moshpit',
      clearnetResolves: true,
      moshpit: registered('profullstack.ai'),
    });
    expect(d.use).toBe('moshpit');
    expect(d.reason).toMatch(/overriding the clearnet domain/i);
    expect(d.resolved).toBe('profullstack.ai');
  });

  it('follows an alias to its target', () => {
    const d = decideResolution({
      hostname: 'profullstack.agentic',
      mode: 'moshpit',
      clearnetResolves: false,
      moshpit: registered('profullstack.agent'),
    });
    expect(d.resolved).toBe('profullstack.agent');
  });

  it('still falls through to clearnet for a name Moshpit does not hold', () => {
    const d = decideResolution({
      hostname: 'example.com',
      mode: 'moshpit',
      clearnetResolves: true,
      moshpit: unregistered,
    });
    expect(d.use).toBe('clearnet');
  });
});

describe('decideResolution — a registry outage must not break browsing', () => {
  it.each(['clearnet', 'moshpit'] as const)('falls back to clearnet in %s mode', (mode) => {
    const d = decideResolution({
      hostname: 'profullstack.ai',
      mode,
      clearnetResolves: true,
      moshpit: null,
    });
    expect(d.use).toBe('clearnet');
    expect(d.reason).toMatch(/unreachable|not consulted/i);
  });

  it('always explains itself', () => {
    // Every branch carries a reason, so an override never looks like a glitch.
    for (const mode of ['clearnet', 'moshpit'] as const) {
      for (const clearnetResolves of [true, false]) {
        for (const moshpit of [null, unregistered, registered('x.y')]) {
          const d = decideResolution({ hostname: 'x.y', mode, clearnetResolves, moshpit });
          expect(d.reason.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('parseRegistryName', () => {
  it('accepts exactly one label and one TLD', () => {
    expect(parseRegistryName('fuck.yeah')).toEqual({ label: 'fuck', tld: 'yeah' });
    expect(parseRegistryName('California.Oranges')).toEqual({ label: 'california', tld: 'oranges' });
    expect(parseRegistryName('original.sploof.')).toEqual({ label: 'original', tld: 'sploof' });
  });

  it('rejects anything that is not a registry name', () => {
    // Sending these to the registry would be asking about a name that cannot
    // exist — and acting on the answer would misroute ordinary browsing.
    expect(parseRegistryName('a.b.c')).toBeNull();
    expect(parseRegistryName('localhost')).toBeNull();
    expect(parseRegistryName('192.168.1.1')).toBeNull();
    expect(parseRegistryName('box.example.com:9161')).toBeNull();
    expect(parseRegistryName('')).toBeNull();
    expect(parseRegistryName('-bad.yeah')).toBeNull();
  });
});

describe('lookupMoshpit', () => {
  const okFetch = (body: unknown): typeof fetch =>
    vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;

  it('reads the registry answer', async () => {
    const result = await lookupMoshpit('profullstack.agentic', {
      fetchImpl: okFetch({ name: 'profullstack.agentic', resolved: 'profullstack.agent', registered: true }),
    });
    expect(result).toEqual({ registered: true, resolved: 'profullstack.agent', target: null });
  });

  it('prefers name_registered over the TLD-level registered flag', async () => {
    const result = await lookupMoshpit('x.eggs', {
      // `.eggs` is claimed by someone, but `x.eggs` itself is not.
      fetchImpl: okFetch({ registered: true, name_registered: false, resolved: 'x.eggs', target: null }),
    });
    expect(result).toEqual({ registered: false, resolved: 'x.eggs', target: null });
  });

  it('carries the target through — it is what separates live from parked', async () => {
    const result = await lookupMoshpit('x.eggs', {
      fetchImpl: okFetch({ name_registered: true, resolved: 'x.eggs', target: '203.0.113.7' }),
    });
    expect(result?.target).toBe('203.0.113.7');
  });

  it('never asks about a name the registry could not hold', async () => {
    const fetchImpl = okFetch({ registered: true, resolved: 'x' });
    expect(await lookupMoshpit('a.b.c', { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when the registry is down', async () => {
    const dead = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await lookupMoshpit('fuck.yeah', { fetchImpl: dead })).toBeNull();
  });

  it('returns null on a nonsense payload', async () => {
    expect(await lookupMoshpit('fuck.yeah', { fetchImpl: okFetch({ nope: 1 }) })).toBeNull();
  });
});

describe('gatewayUrlFor', () => {
  it('builds a gateway URL and tolerates a trailing slash', () => {
    expect(gatewayUrlFor('fuck.yeah')).toBe('https://pit.moshcode.sh/n/fuck.yeah');
    expect(gatewayUrlFor('fuck.yeah', 'https://my.pit/')).toBe('https://my.pit/n/fuck.yeah');
  });
});

describe('consoleUrlFor', () => {
  it('points mosh.<tld> at the Pit for that TLD', () => {
    expect(consoleUrlFor('mosh.eggs')).toBe('https://app.moshcode.sh/pit?tld=eggs');
    expect(consoleUrlFor('MOSH.Whatever')).toBe('https://app.moshcode.sh/pit?tld=whatever');
  });

  it('tolerates a trailing slash on an overridden console', () => {
    expect(consoleUrlFor('mosh.eggs', 'https://my.console/')).toBe(
      'https://my.console/pit?tld=eggs',
    );
  });

  it('is null for anything that is not a mosh.<tld> name', () => {
    expect(consoleUrlFor('eggs.mosh')).toBeNull();   // the other way round
    expect(consoleUrlFor('moshy.eggs')).toBeNull();  // not the reserved label
    expect(consoleUrlFor('a.mosh.eggs')).toBeNull(); // too many labels
    expect(consoleUrlFor('mosh')).toBeNull();        // no TLD
  });
});

describe('decideResolution — the registration console', () => {
  it('sends mosh.<tld> to the Pit when clearnet has no answer', () => {
    const d = decideResolution({
      hostname: 'mosh.eggs',
      mode: 'clearnet',
      clearnetResolves: false,
      moshpit: null,
    });
    expect(d.use).toBe('register');
    expect(d.url).toBe('https://app.moshcode.sh/pit?tld=eggs');
  });

  it('never swallows a real clearnet domain like mosh.org in the default mode', () => {
    const d = decideResolution({
      hostname: 'mosh.org',
      mode: 'clearnet',
      clearnetResolves: true,
      moshpit: null,
    });
    expect(d.use).toBe('clearnet');
  });

  it('takes the console over clearnet once the user opts into moshpit mode', () => {
    const d = decideResolution({
      hostname: 'mosh.org',
      mode: 'moshpit',
      clearnetResolves: true,
      moshpit: null,
    });
    expect(d.use).toBe('register');
    expect(d.url).toBe('https://app.moshcode.sh/pit?tld=org');
  });

  it('beats a registered name — the console label is reserved, not claimable', () => {
    const d = decideResolution({
      hostname: 'mosh.eggs',
      mode: 'moshpit',
      clearnetResolves: false,
      moshpit: registered('someone-elses-squat.eggs'),
    });
    expect(d.use).toBe('register');
  });

  it('honours an overridden console base', () => {
    const d = decideResolution({
      hostname: 'mosh.eggs',
      mode: 'clearnet',
      clearnetResolves: false,
      moshpit: null,
      consoleBase: 'https://my.console',
    });
    expect(d.url).toBe('https://my.console/pit?tld=eggs');
  });
});

describe('decideResolution — parking unpointed names', () => {
  it('parks an unclaimed name instead of dead-ending on a DNS error', () => {
    const d = decideResolution({
      hostname: 'california.oranges',
      mode: 'clearnet',
      clearnetResolves: false,
      moshpit: unregistered,
    });
    expect(d.use).toBe('park');
    expect(d.url).toBe('https://pit.moshcode.sh/n/california.oranges');
  });

  it('parks a claimed name that is not pointed at an address yet', () => {
    const d = decideResolution({
      hostname: 'california.oranges',
      mode: 'moshpit',
      clearnetResolves: false,
      moshpit: unpointed('california.oranges'),
    });
    expect(d.use).toBe('park');
  });

  it('never replaces a working clearnet domain with a parking page', () => {
    for (const mode of ['clearnet', 'moshpit'] as const) {
      const d = decideResolution({
        hostname: 'example.com',
        mode,
        clearnetResolves: true,
        moshpit: unregistered,
      });
      expect(d.use).toBe('clearnet');
    }
  });

  it('does not park when the registry was unreachable — that would be a lie', () => {
    const d = decideResolution({
      hostname: 'california.oranges',
      mode: 'clearnet',
      clearnetResolves: false,
      moshpit: null,
    });
    expect(d.use).toBe('clearnet');
  });

  it('honours an overridden parking base', () => {
    const d = decideResolution({
      hostname: 'california.oranges',
      mode: 'clearnet',
      clearnetResolves: false,
      moshpit: unregistered,
      parkingBase: 'https://my.park/',
    });
    expect(d.url).toBe('https://my.park/n/california.oranges');
  });
});

describe('dashes are not part of a Moshpit name', () => {
  // Kept identical to the registry on purpose. A name this accepts and the
  // registry rejects forwards the tab to a page saying it does not exist,
  // which is a worse failure than refusing it here.
  it('refuses a dash anywhere in either half', () => {
    for (const host of [
      'lazy-loaded.eggs',
      'blue.lazy-loaded',
      'register-me.eggs',
      'a-b.c-d',
      '-bad.eggs',
      'bad-.eggs',
    ]) {
      expect(parseRegistryName(host), host).toBeNull();
    }
  });

  it('still accepts what the registry accepts', () => {
    expect(parseRegistryName('california.oranges')).toEqual({ label: 'california', tld: 'oranges' });
    expect(parseRegistryName('blue.420')).toEqual({ label: 'blue', tld: '420' });
    expect(parseRegistryName(`${'a'.repeat(63)}.eggs`)).toEqual({ label: 'a'.repeat(63), tld: 'eggs' });
    expect(parseRegistryName(`${'a'.repeat(64)}.eggs`)).toBeNull();
  });
});
