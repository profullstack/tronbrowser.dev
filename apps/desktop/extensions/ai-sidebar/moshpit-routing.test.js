// What each navigation is routed to, and — as much as it matters — what it
// costs. These are the regressions the DNS-based version could not express.
import { describe, expect, it } from 'vitest';

import { routeForDnsFailure, routeForNavigation, territoryOf } from './moshpit-routing.js';

const ONION = 'duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion';

describe('territoryOf', () => {
  it('sorts every hostname into exactly one territory', () => {
    expect(territoryOf('blue.eggs')).toBe('moshpit');
    expect(territoryOf('google.com')).toBe('clearnet');
    expect(territoryOf(ONION)).toBe('reserved');
    expect(territoryOf('printer.local')).toBe('reserved');
    expect(territoryOf('a.b.c')).toBe('none');       // three labels
    expect(territoryOf('1.2.3.4')).toBe('none');     // an IP
    expect(territoryOf('localhost')).toBe('none');   // no ending
    expect(territoryOf('my-site.eggs')).toBe('none'); // a dash — the registry rejects it
    expect(territoryOf('')).toBe('none');
  });
});

describe('a Moshpit name resolves even when the resolver lies about it', () => {
  // The bug: an NXDOMAIN-hijacking resolver answers for blue.eggs, so
  // ERR_NAME_NOT_RESOLVED never fires and the old code never ran at all.
  it('resolves in the DEFAULT mode, without waiting for a DNS error', () => {
    const r = routeForNavigation('blue.eggs', 'clearnet');
    expect(r.resolve).toBe(true);
    // The whole point: we assert clearnet has no answer regardless of DNS.
    expect(r.clearnetResolves).toBe(false);
  });

  it('resolves in moshpit mode the same way', () => {
    expect(routeForNavigation('blue.eggs', 'moshpit')).toMatchObject({
      resolve: true, clearnetResolves: false,
    });
  });

  it('does not run again on the DNS error, which would race the redirect', () => {
    expect(routeForDnsFailure('blue.eggs').resolve).toBe(false);
  });
});

describe('ordinary browsing costs nothing', () => {
  it('leaves a real ending alone in the default mode', () => {
    const r = routeForNavigation('google.com', 'clearnet');
    expect(r.resolve).toBe(false);
    expect(r.why).toMatch(/backfill only/);
  });

  it('still lets moshpit mode override a real ending — that is what it is for', () => {
    expect(routeForNavigation('google.com', 'moshpit')).toMatchObject({
      resolve: true, clearnetResolves: true,
    });
  });

  it('backfills a real ending whose DNS honestly failed', () => {
    expect(routeForDnsFailure('nothing.com')).toMatchObject({
      resolve: true, clearnetResolves: false,
    });
  });
});

describe('a .onion address never reaches the registry', () => {
  // It is two alphanumeric labels, so the shape test alone accepts it. The
  // registry hosts bypass the SOCKS proxy, so a lookup would carry the onion
  // address out over clearnet.
  it('is left alone in both modes', () => {
    for (const mode of ['clearnet', 'moshpit']) {
      const r = routeForNavigation(ONION, mode);
      expect(r.resolve, mode).toBe(false);
      expect(r.why, mode).toMatch(/reserved/);
    }
  });

  it('is left alone on a DNS failure too', () => {
    expect(routeForDnsFailure(ONION).resolve).toBe(false);
  });

  it('applies to the other reserved endings as well', () => {
    for (const h of ['printer.local', 'box.lan', 'app.internal', 'foo.test']) {
      expect(routeForNavigation(h, 'moshpit').resolve, h).toBe(false);
    }
  });
});

describe('the decision is total', () => {
  it('returns a usable shape for every combination', () => {
    const hosts = ['blue.eggs', 'google.com', ONION, 'a.b.c', '', 'localhost', '1.2.3.4'];
    for (const h of hosts) {
      for (const mode of ['clearnet', 'moshpit', undefined]) {
        for (const fn of [routeForNavigation, routeForDnsFailure]) {
          const r = fn(h, mode);
          expect(typeof r.resolve, `${fn.name} ${h} ${mode}`).toBe('boolean');
          expect(typeof r.why, `${fn.name} ${h} ${mode}`).toBe('string');
          if (r.resolve) expect(typeof r.clearnetResolves).toBe('boolean');
        }
      }
    }
  });
});
