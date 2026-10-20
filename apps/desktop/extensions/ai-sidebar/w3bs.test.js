import { describe, expect, it } from 'vitest';
import { w3bsUrl } from './w3bs.js';

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
