import { describe, it, expect } from 'vitest';
import { resolveStartUrls } from './launcher.js';

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
