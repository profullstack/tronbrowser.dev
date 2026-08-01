import { describe, expect, it } from 'vitest';
import { HOME, normalizeUrl } from './navigation';

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
});
