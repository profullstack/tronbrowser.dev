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
    const lookups = [null, { registered: false, resolved: '' }, { registered: true, resolved: 'r.eggs' }];
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
      json: async () => ({ registered: true, resolved: 'original.sploof' }),
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
      return { ok: true, json: async () => ({ registered: true, resolved: 'a.eggs' }) };
    };
    expect(await js.destinationFor('a.eggs', false)).toBe('https://my.pit/n/a.eggs');
    expect(asked).toContain('https://my.pit/api/moshpit/resolve');
  });
});

describe('destinationFor — parking', () => {
  it('sends an unclaimed name to the parking page', async () => {
    globalThis.chrome = { storage: { local: { get: async () => ({ moshpitConfig: { mode: 'clearnet' } }) } } };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ registered: false }) });
    expect(await js.destinationFor('california.oranges', false)).toBe(
      'https://moshcoding.com/parking?name=california.oranges',
    );
  });

  it('leaves a working clearnet domain alone rather than parking it', async () => {
    globalThis.chrome = { storage: { local: { get: async () => ({ moshpitConfig: { mode: 'clearnet' } }) } } };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ registered: false }) });
    expect(await js.destinationFor('example.com', true)).toBeNull();
  });
});
