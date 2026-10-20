import { describe, expect, it } from 'vitest';
import { w3bsFromSearch, w3bsUrl } from './w3bs.js';

describe('w3bsUrl', () => {
  it('sends a W3BS URI to the w3bs.org resolver', () => {
    expect(w3bsUrl('w3bs://prompt/w3bs/research@1')).toBe(
      'https://w3bs.org/browse?q=w3bs%3A%2F%2Fprompt%2Fw3bs%2Fresearch%401',
    );
  });

  it('accepts any case and surrounding space', () => {
    expect(w3bsUrl('  W3BS://prompt/w3bs/research ')).toBe(
      'https://w3bs.org/browse?q=W3BS%3A%2F%2Fprompt%2Fw3bs%2Fresearch',
    );
  });

  it('leaves everything else alone', () => {
    expect(w3bsUrl('https://w3bs.org')).toBeNull();
    expect(w3bsUrl('what is w3bs://')).toBeNull();
    expect(w3bsUrl('')).toBeNull();
  });
});

describe('w3bsFromSearch', () => {
  it('turns a search for a W3BS URI into the resolver', () => {
    expect(w3bsFromSearch('https://pit.world/search?q=w3bs%3A%2F%2Fchovy.hacker')).toBe(
      'https://w3bs.org/browse?q=w3bs%3A%2F%2Fchovy.hacker',
    );
    expect(w3bsFromSearch('https://duckduckgo.com/?q=W3BS%3A%2F%2Fprompt%2Fw3bs%2Fresearch&ia=web')).toBe(
      'https://w3bs.org/browse?q=W3BS%3A%2F%2Fprompt%2Fw3bs%2Fresearch',
    );
  });

  it('leaves other pages, other searches and w3bs.org alone', () => {
    expect(w3bsFromSearch('https://pit.world/search?q=hello+w3bs')).toBeNull();
    expect(w3bsFromSearch('https://w3bs.org/browse?q=w3bs%3A%2F%2Fchovy.hacker')).toBeNull();
    expect(w3bsFromSearch('chrome://newtab/')).toBeNull();
    expect(w3bsFromSearch('not a url')).toBeNull();
  });
});
