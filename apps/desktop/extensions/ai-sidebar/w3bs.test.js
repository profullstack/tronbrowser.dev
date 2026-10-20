import { describe, expect, it } from 'vitest';
import { PIT_DIRECT_RULES, w3bsFromSearch, w3bsSiteUrl, w3bsUrl } from './w3bs.js';

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

  it('with Pit on, opens a named site itself, from the search or the resolver hop', () => {
    const pit = { pit: true };
    expect(w3bsFromSearch('https://pit.world/search?q=w3bs%3A%2F%2Fchovy.hacker', pit)).toBe('https://chovy.hacker/');
    expect(w3bsFromSearch('https://w3bs.org/browse?q=w3bs%3A%2F%2FChovy.Hacker%2Fblog', pit)).toBe(
      'https://chovy.hacker/blog',
    );
    // Resources still go to the resolver; w3bs.org pages that are not a site stay put.
    expect(w3bsFromSearch('https://pit.world/search?q=w3bs%3A%2F%2Fprompt%2Fw3bs%2Fresearch', pit)).toBe(
      'https://w3bs.org/browse?q=w3bs%3A%2F%2Fprompt%2Fw3bs%2Fresearch',
    );
    expect(w3bsFromSearch('https://w3bs.org/browse?q=w3bs%3A%2F%2Fprompt%2Fw3bs%2Fresearch', pit)).toBeNull();
  });
});

describe('w3bsSiteUrl', () => {
  it('reads a dotted authority as a site, and nothing else', () => {
    expect(w3bsSiteUrl('w3bs://chovy.hacker')).toBe('https://chovy.hacker/');
    expect(w3bsSiteUrl('w3bs://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(w3bsSiteUrl('w3bs://prompt/w3bs/research@1')).toBeNull();
    expect(w3bsSiteUrl('https://chovy.hacker')).toBeNull();
  });
});

describe('PIT_DIRECT_RULES', () => {
  // Chromium's regexFilter is RE2; this pattern is plain enough to read the same in JS.
  const rule = PIT_DIRECT_RULES[0];
  const re = new RegExp(rule.condition.regexFilter, 'i');
  const apply = (href) => {
    const m = re.exec(href);
    return m ? rule.action.redirect.regexSubstitution.replace('\\1', m[1]) : null;
  };

  it('sends a w3bs://<name> search, or its resolver hop, to the name itself', () => {
    expect(apply('https://pit.world/search?q=w3bs%3A%2F%2Fchovy.hacker')).toBe('https://chovy.hacker/');
    expect(apply('https://duckduckgo.com/?q=w3bs%3A%2F%2Fchovy.hacker&ia=web')).toBe('https://chovy.hacker/');
    expect(apply('https://w3bs.org/browse?q=w3bs%3A%2F%2Fchovy.hacker')).toBe('https://chovy.hacker/');
    expect(apply('https://w3bs.org/browse?q=w3bs://chovy.hacker')).toBe('https://chovy.hacker/');
  });

  it('leaves resources, paths and other searches to the resolver', () => {
    expect(apply('https://pit.world/search?q=w3bs%3A%2F%2Fprompt%2Fw3bs%2Fresearch')).toBeNull();
    expect(apply('https://pit.world/search?q=w3bs%3A%2F%2Fchovy.hacker%2Fblog')).toBeNull();
    expect(apply('https://pit.world/search?q=chovy.hacker')).toBeNull();
  });
});
