import { describe, expect, it } from 'vitest';
import { HOME, navigableHttpUrl, normalizeUrl } from './navigation';

describe('normalizeUrl', () => {
  it('returns home for blank input', () => {
    expect(normalizeUrl('   ')).toBe(HOME);
  });

  it('keeps valid HTTP(S) URLs', () => {
    expect(normalizeUrl('https://example.com/path?q=1')).toBe(
      'https://example.com/path?q=1',
    );
    expect(normalizeUrl('http://localhost:3000/health')).toBe(
      'http://localhost:3000/health',
    );
  });

  it('promotes a complete domain to HTTPS', () => {
    expect(normalizeUrl('docs.example.com/path')).toBe(
      'https://docs.example.com/path',
    );
  });

  it('searches ordinary text', () => {
    expect(normalizeUrl('privacy first browser')).toBe(
      'https://duckduckgo.com/?q=privacy%20first%20browser',
    );
  });

  it('searches unsupported schemes instead of loading them', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBe(
      'https://duckduckgo.com/?q=javascript%3Aalert(1)',
    );
  });

  it('does not treat domain-looking text with spaces as a URL', () => {
    expect(normalizeUrl('example.com malicious suffix')).toBe(
      'https://duckduckgo.com/?q=example.com%20malicious%20suffix',
    );
  });

  it('searches with a no-account engine, not Kagi', () => {
    // Kagi needs a subscription after its trial; a fresh install must be able
    // to search out of the box, matching the desktop DuckDuckGo default.
    expect(normalizeUrl('some query')).not.toContain('kagi.com');
  });
});

describe('navigableHttpUrl', () => {
  it('accepts absolute HTTP(S) URLs', () => {
    expect(navigableHttpUrl('https://example.com/next?page=2')).toBe(
      'https://example.com/next?page=2',
    );
    expect(navigableHttpUrl('http://localhost:8080/dev')).toBe(
      'http://localhost:8080/dev',
    );
  });

  it('rejects script and data schemes instead of falling back to search', () => {
    expect(navigableHttpUrl('javascript:alert(document.cookie)')).toBeNull();
    expect(navigableHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects other non-web schemes and relative junk', () => {
    expect(navigableHttpUrl('intent://scan/#Intent;scheme=zxing;end')).toBeNull();
    expect(navigableHttpUrl('about:blank')).toBeNull();
    expect(navigableHttpUrl('file:///etc/passwd')).toBeNull();
    expect(navigableHttpUrl('example.com/no-scheme')).toBeNull();
    expect(navigableHttpUrl('   ')).toBeNull();
  });
});
