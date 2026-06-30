import { describe, it, expect } from 'vitest';
import { resolveStartUrls, launch } from './launcher.js';

describe('resolveStartUrls', () => {
  it('injects no URL on a bare launch (NTP feed comes from the startup pref)', () => {
    expect(resolveStartUrls()).toEqual([]);
    expect(resolveStartUrls([])).toEqual([]);
  });

  it('respects explicit URLs when provided', () => {
    expect(resolveStartUrls(['https://example.com'])).toEqual(['https://example.com']);
    expect(resolveStartUrls(['https://a.com', 'https://b.com'])).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });
});

describe('launch', () => {
  it('refuses the sync path for Tor mode (must use launchWithTor)', () => {
    expect(() => launch({ outDir: '/tmp/out', tor: true })).toThrow(/launchWithTor/);
  });
});
