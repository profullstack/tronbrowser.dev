import { describe, it, expect } from 'vitest';
import { resolveStartUrls, DEFAULT_START_URL } from './launcher.js';

describe('resolveStartUrls', () => {
  it('opens the feed (new tab page) when no URLs are given', () => {
    expect(resolveStartUrls()).toEqual([DEFAULT_START_URL]);
    expect(resolveStartUrls([])).toEqual([DEFAULT_START_URL]);
  });

  it('respects explicit URLs when provided', () => {
    expect(resolveStartUrls(['https://example.com'])).toEqual(['https://example.com']);
    expect(resolveStartUrls(['https://a.com', 'https://b.com'])).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('defaults to the extension-overridden new tab page', () => {
    expect(DEFAULT_START_URL).toBe('chrome://newtab/');
  });
});
