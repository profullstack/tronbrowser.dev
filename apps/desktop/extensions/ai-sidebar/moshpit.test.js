// The extension's moshpit.js is a hand port of ../../src/moshpit-resolve.ts,
// because the extension is plain JS with no build step. A port that silently
// drifts from its reference is worse than no port at all — it makes the browser
// behave differently from the module everyone reads and tests. So these tests
// run BOTH implementations over the same inputs and require identical answers.

import { describe, expect, it } from 'vitest';

import * as ts from '../../src/moshpit-resolve';
import * as js from './moshpit.js';

const HOSTNAMES = [
  'mosh.eggs',
  'MOSH.Whatever',
  'mosh.org',
  'moshy.eggs',
  'eggs.mosh',
  'fuck.yeah',
  'profullstack.ai',
  'a.b.c',
  'localhost',
  '127.0.0.1',
  'mosh',
  '',
  'x.y',
  // Dashes. The list carried none, so a change to whether a dash may appear in
  // a label could land in one implementation and not the other and every
  // assertion below would still agree.
  'lazy-loaded',
  'blue.lazy-loaded',
  'register-me.eggs',
  'a-b.c-d',
  '-bad.eggs',
  'bad-.eggs',
];

describe('moshpit.js is faithful to moshpit-resolve.ts', () => {
  it('parseRegistryName agrees on every hostname shape', () => {
    for (const h of HOSTNAMES) {
      expect(js.parseRegistryName(h), h).toEqual(ts.parseRegistryName(h));
    }
  });

  it('consoleUrlFor agrees on every hostname shape', () => {
    for (const h of HOSTNAMES) {
      expect(js.consoleUrlFor(h), h).toEqual(ts.consoleUrlFor(h));
    }
  });

  it('gatewayUrlFor agrees', () => {
    expect(js.gatewayUrlFor('fuck.yeah')).toBe(ts.gatewayUrlFor('fuck.yeah'));
    expect(js.gatewayUrlFor('fuck.yeah', 'https://my.pit/')).toBe(
      ts.gatewayUrlFor('fuck.yeah', 'https://my.pit/'),
    );
  });

  it('decideResolution agrees across the whole input space', () => {
    const lookups = [
      null,
      { registered: false, resolved: '', target: null },
      { registered: true, resolved: 'r.eggs', target: null },   // claimed, unpointed -> parks
      { registered: true, resolved: 'r.eggs', target: '203.0.113.7' }, // live
    ];
    for (const hostname of HOSTNAMES) {
      for (const mode of ['clearnet', 'moshpit']) {
        for (const clearnetResolves of [true, false]) {
          for (const moshpit of lookups) {
            const inputs = { hostname, mode, clearnetResolves, moshpit };
            expect(js.decideResolution(inputs), JSON.stringify(inputs)).toEqual(
              ts.decideResolution(inputs),
            );
          }
        }
      }
    }
  });

  it('shares the same constants', () => {
    expect(js.CONSOLE_LABEL).toBe(ts.CONSOLE_LABEL);
    expect(js.DEFAULT_CONSOLE_BASE).toBe(ts.DEFAULT_CONSOLE_BASE);
    expect(js.DEFAULT_REGISTRY_BASE).toBe(ts.DEFAULT_REGISTRY_BASE);
  });
});

describe('destinationFor — the URL a navigation actually ends up at', () => {
  const withConfig = (moshpitConfig) => {
    globalThis.chrome = {
      storage: { local: { get: async () => ({ moshpitConfig }) } },
    };
  };

  it('sends mosh.<tld> to the Pit without ever contacting the registry', async () => {
    withConfig({ mode: 'clearnet' });
    globalThis.fetch = () => {
      throw new Error('registry must not be consulted for the reserved label');
    };
    expect(await js.destinationFor('mosh.eggs', false)).toBe(
      'https://app.moshcode.sh/pit?tld=eggs',
    );
  });

  it('leaves a working clearnet domain alone in the default mode', async () => {
    withConfig({ mode: 'clearnet' });
    expect(await js.destinationFor('mosh.org', true)).toBeNull();
  });

  it('ignores anything that is not a single label + TLD', async () => {
    withConfig({ mode: 'moshpit' });
    expect(await js.destinationFor('a.b.c', false)).toBeNull();
    expect(await js.destinationFor('pit.moshcode.sh', false)).toBeNull(); // no redirect loop
    expect(await js.destinationFor('app.moshcode.sh', false)).toBeNull();
  });

  it('routes a registered name through the gateway when DNS came up empty', async () => {
    withConfig({ mode: 'clearnet' });
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ name_registered: true, resolved: 'original.sploof', target: '203.0.113.7' }),
    });
    expect(await js.destinationFor('alias.sploof', false)).toBe(
      'https://pit.moshcode.sh/n/original.sploof',
    );
  });

  it('degrades to clearnet when the registry is unreachable', async () => {
    withConfig({ mode: 'moshpit' });
    globalThis.fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(await js.destinationFor('fuck.yeah', true)).toBeNull();
  });

  it('honours a self-hosted registry base', async () => {
    withConfig({ mode: 'clearnet', registryBase: 'https://my.pit/' });
    let asked = '';
    globalThis.fetch = async (url) => {
      asked = url;
      return { ok: true, json: async () => ({ name_registered: true, resolved: 'a.eggs', target: '203.0.113.7' }) };
    };
    expect(await js.destinationFor('a.eggs', false)).toBe('https://my.pit/n/a.eggs');
    expect(asked).toContain('https://my.pit/api/moshpit/resolve');
  });
});

describe('destinationFor — parking', () => {
  it('sends an unclaimed name to the parking page', async () => {
    globalThis.chrome = { storage: { local: { get: async () => ({ moshpitConfig: { mode: 'clearnet' } }) } } };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ name_registered: false, target: null }) });
    expect(await js.destinationFor('california.oranges', false)).toBe(
      'https://pit.moshcode.sh/n/california.oranges',
    );
  });

  it('leaves a working clearnet domain alone rather than parking it', async () => {
    globalThis.chrome = { storage: { local: { get: async () => ({ moshpitConfig: { mode: 'clearnet' } }) } } };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ name_registered: false, target: null }) });
    expect(await js.destinationFor('example.com', true)).toBeNull();
  });
});

describe('lookupMoshpit — the registry payload as it really is', () => {
  const asRegistry = (payload) => {
    globalThis.fetch = async () => ({ ok: true, json: async () => payload });
  };

  it('parks a claimed-but-unpointed name — the real california.oranges response', async () => {
    globalThis.chrome = { storage: { local: { get: async () => ({ moshpitConfig: { mode: 'clearnet' } }) } } };
    // Verbatim from https://pit.moshcode.sh/api/moshpit/resolve?name=california.oranges
    asRegistry({
      name: 'california.oranges',
      resolved: 'california.oranges',
      aliased: false,
      registered: true,
      name_registered: true,
      target: null,
      mode: 'clearnet',
      prefer: 'fallback',
    });
    expect(await js.destinationFor('california.oranges', false)).toBe(
      'https://pit.moshcode.sh/n/california.oranges',
    );
  });

  it('reads name_registered, not the TLD-level registered flag', async () => {
    asRegistry({ registered: true, name_registered: false, resolved: 'x.eggs', target: null });
    expect(await js.lookupMoshpit('x.eggs')).toEqual({
      registered: false,
      resolved: 'x.eggs',
      target: null,
    });
  });

  it('treats a present target as the address the name points at', async () => {
    asRegistry({ name_registered: true, resolved: 'x.eggs', target: '203.0.113.7' });
    expect((await js.lookupMoshpit('x.eggs')).target).toBe('203.0.113.7');
  });
});

describe('hosts that bypass Tor', () => {
  it('lifts the hostname out of each configured base', () => {
    expect(js.moshpitBypassHosts({
      registryBase: 'https://pit.moshcode.sh',
      consoleBase: 'https://app.moshcode.sh',
      parkingBase: 'https://app.moshcode.sh',
    })).toEqual(['pit.moshcode.sh', 'app.moshcode.sh']);
  });

  it('follows a self-hosted pit rather than hardcoding the public one', () => {
    // The whole reason this is computed: someone pointing at their own pit
    // needs the same bypass, or Tor breaks resolution for them and not for us.
    expect(js.moshpitBypassHosts({ registryBase: 'https://my.pit:8443' }))
      .toEqual(['my.pit']);
  });

  it('drops a port, since a proxy bypass entry matches on host', () => {
    expect(js.moshpitBypassHosts({ registryBase: 'https://pit.example:9443' }))
      .toEqual(['pit.example']);
  });

  it('survives missing or unparseable bases instead of throwing', () => {
    // Called while enabling Tor; throwing here would leave the proxy unset and
    // the browser routing in the clear while the badge says TOR.
    expect(js.moshpitBypassHosts({})).toEqual([]);
    expect(js.moshpitBypassHosts(undefined)).toEqual([]);
    expect(js.moshpitBypassHosts({ registryBase: 'not a url' })).toEqual([]);
  });

  it('never routes loopback through Tor by accident', () => {
    expect(js.moshpitBypassHosts({ registryBase: 'http://127.0.0.1:8787' }))
      .toEqual(['127.0.0.1']);
  });
});

describe('the lookup budget', () => {
  it('is the same in both ports', () => {
    expect(js.DEFAULT_LOOKUP_TIMEOUT_MS).toBe(ts.DEFAULT_LOOKUP_TIMEOUT_MS);
  });

  it('leaves room for a slow network without stalling navigation', () => {
    expect(js.DEFAULT_LOOKUP_TIMEOUT_MS).toBeGreaterThan(4000);
    expect(js.DEFAULT_LOOKUP_TIMEOUT_MS).toBeLessThanOrEqual(10000);
  });
});

describe('parking sends a name somewhere that exists', () => {
  it('parks at the registry, not at a route nobody ever built', () => {
    // moshcoding.com/parking has never existed — that is the Next.js site, not
    // the registry. Every unpointed name 404'd, which from a browser is
    // indistinguishable from the namespace not working at all.
    expect(js.parkingUrlFor('scrambled.eggs')).toBe('https://pit.moshcode.sh/n/scrambled.eggs');
    expect(js.DEFAULT_PARKING_BASE).toBe('https://pit.moshcode.sh');
  });

  it('agrees with the TS source of truth', () => {
    expect(js.parkingUrlFor('scrambled.eggs')).toBe(ts.parkingUrlFor('scrambled.eggs'));
    expect(js.DEFAULT_PARKING_BASE).toBe(ts.DEFAULT_PARKING_BASE);
  });

  it('parks and fetches at the same route, because it is the same question', () => {
    // /n/ serves a pointed name and shows the directory for an unpointed one.
    expect(js.parkingUrlFor('a.eggs')).toBe(js.gatewayUrlFor('a.eggs'));
  });

  it('still honours a self-hosted parking base', () => {
    expect(js.parkingUrlFor('a.eggs', 'https://my.pit/')).toBe('https://my.pit/n/a.eggs');
  });

  it('escapes the name rather than pasting it into a URL', () => {
    expect(js.parkingUrlFor('a b.eggs')).toBe('https://pit.moshcode.sh/n/a%20b.eggs');
  });
});

describe('a stored setting must not outlive the default it copied', () => {
  it('ignores a base that is only a superseded default', () => {
    // The bug this fixes: an install that ever persisted moshcoding.com keeps
    // pointing at a route that has never existed, through every future
    // release, and shipping the right default does nothing about it.
    expect(js.storedBase('https://moshcoding.com', 'https://pit.moshcode.sh'))
      .toBe('https://pit.moshcode.sh');
    expect(js.storedBase('http://moshcoding.com', 'https://pit.moshcode.sh'))
      .toBe('https://pit.moshcode.sh');
    expect(js.storedBase('https://moshcoding.com/', 'https://pit.moshcode.sh'))
      .toBe('https://pit.moshcode.sh', 'a trailing slash is the same value');
  });

  it('keeps a base someone actually chose', () => {
    // Only stale defaults are on the list, so a real choice is never on it.
    expect(js.storedBase('https://my.pit', 'https://pit.moshcode.sh')).toBe('https://my.pit');
    expect(js.storedBase('https://my.pit/', 'https://pit.moshcode.sh')).toBe('https://my.pit');
  });

  it('falls through to the shipped default when nothing is stored', () => {
    for (const empty of ['', '   ', null, undefined]) {
      expect(js.storedBase(empty, 'https://pit.moshcode.sh')).toBe('https://pit.moshcode.sh');
    }
  });

  it('lists the base that caused this', () => {
    expect(js.SUPERSEDED_BASES.has('https://moshcoding.com')).toBe(true);
    expect(js.SUPERSEDED_BASES.has('https://pit.moshcode.sh')).toBe(false);
  });
});
