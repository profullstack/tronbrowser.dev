// Which namespace an ending belongs to.
//
// The interesting cases are the ones that used to be decided by DNS: a
// hijacking resolver answers for every name, so anything that asked "did DNS
// fail?" got the wrong answer on those connections. These tests ask the ending
// instead, which is the same answer on every network.
import { describe, expect, it } from 'vitest';

import {
  IANA_TLD_VERSION,
  RESERVED_TLDS,
  clearnetCanAnswer,
  isIcannTld,
  isMoshpitOnlyNamespace,
  isReservedNamespace,
  isReservedTld,
  tldOf,
} from './tlds.js';
import { IANA_TLDS } from './tld-data.js';

describe('the generated IANA list', () => {
  it('is the real list, not a truncated one', () => {
    expect(IANA_TLDS.length).toBeGreaterThan(1000);
    expect(IANA_TLD_VERSION).toMatch(/^\d{10}$/);
  });

  it('is lowercase, sorted, and free of duplicates', () => {
    expect(IANA_TLDS).toEqual([...IANA_TLDS].map((t) => t.toLowerCase()));
    expect(IANA_TLDS).toEqual([...IANA_TLDS].sort());
    expect(new Set(IANA_TLDS).size).toBe(IANA_TLDS.length);
  });

  it('carries the endings the world actually uses', () => {
    for (const t of ['com', 'org', 'net', 'io', 'dev', 'sh', 'uk', 'de', 'jp']) {
      expect(isIcannTld(t), t).toBe(true);
    }
  });

  it('carries internationalized endings too', () => {
    expect(IANA_TLDS.some((t) => t.startsWith('xn--'))).toBe(true);
  });

  it('does not contain the Moshpit endings — the whole fix depends on it', () => {
    for (const t of ['eggs', 'oranges', 'moshpit']) {
      expect(isIcannTld(t), t).toBe(false);
    }
  });
});

describe('tldOf', () => {
  it('takes the last label, case- and root-insensitively', () => {
    expect(tldOf('blue.eggs')).toBe('eggs');
    expect(tldOf('A.EGGS.')).toBe('eggs');
    expect(tldOf('deep.sub.example.com')).toBe('com');
  });

  it('has nothing to return for a hostname with no ending', () => {
    for (const h of ['', 'localhost', 'eggs', null, undefined]) {
      expect(tldOf(h), String(h)).toBe('');
    }
  });

  it('refuses a host:port rather than reading the port as an ending', () => {
    expect(tldOf('blue.eggs:8080')).toBe('');
  });
});

describe('clearnet vs Moshpit territory', () => {
  it('puts a real ending in clearnet, where the registry is never consulted', () => {
    for (const h of ['google.com', 'a.org', 'x.dev']) {
      expect(clearnetCanAnswer(h), h).toBe(true);
      expect(isMoshpitOnlyNamespace(h), h).toBe(false);
    }
  });

  it('puts an ending nobody else could own in Moshpit — regardless of DNS', () => {
    // This is the hijack case: the resolver answers, and it is still not
    // clearnet's name to answer for.
    for (const h of ['blue.eggs', 'california.oranges', 'mosh.eggs']) {
      expect(clearnetCanAnswer(h), h).toBe(false);
      expect(isMoshpitOnlyNamespace(h), h).toBe(true);
    }
  });

  it('never claims a hostname with no ending', () => {
    for (const h of ['localhost', '', 'eggs']) {
      expect(isMoshpitOnlyNamespace(h), h).toBe(false);
    }
  });
});

describe('reserved endings stay out of the registry entirely', () => {
  it('treats a real v3 onion address as Tor’s, not Moshpit’s', () => {
    const onion = 'duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion';
    expect(isReservedNamespace(onion)).toBe(true);
    // The bug this closes: it is two alphanumeric labels, so the shape test
    // alone would have sent it to the registry over clearnet.
    expect(isMoshpitOnlyNamespace(onion)).toBe(false);
  });

  it('leaves local and private-network endings alone', () => {
    for (const t of ['local', 'localhost', 'test', 'invalid', 'example',
      'internal', 'alt', 'home', 'lan', 'corp', 'intranet']) {
      expect(isReservedTld(t), t).toBe(true);
      expect(isMoshpitOnlyNamespace(`host.${t}`), t).toBe(false);
    }
  });

  it('does not reserve an ending IANA already delegates', () => {
    // A reserved entry that IANA later delegates would quietly shadow a real
    // TLD, so the two sets must stay disjoint.
    for (const t of RESERVED_TLDS) {
      expect(isIcannTld(t), t).toBe(false);
    }
  });
});
