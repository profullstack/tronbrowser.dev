import { describe, it, expect } from 'vitest';
import { safeRedirect } from './redirect.js';

const APP = 'https://tronbrowser.dev';

describe('safeRedirect', () => {
  it('allows site-relative paths (resolved against our origin)', () => {
    expect(safeRedirect('/dashboard', APP)).toBe('https://tronbrowser.dev/dashboard');
    expect(safeRedirect('/a/b?x=1', APP)).toBe('https://tronbrowser.dev/a/b?x=1');
  });

  it('allows absolute same-origin URLs', () => {
    expect(safeRedirect('https://tronbrowser.dev/x', APP)).toBe('https://tronbrowser.dev/x');
  });

  it('rejects external hosts (prevents session-token exfiltration)', () => {
    expect(safeRedirect('https://evil.com', APP)).toBeUndefined();
    expect(safeRedirect('https://tronbrowser.dev.evil.com/x', APP)).toBeUndefined();
  });

  it('rejects protocol-relative, scheme and cross-scheme tricks', () => {
    expect(safeRedirect('//evil.com', APP)).toBeUndefined();
    expect(safeRedirect('javascript:alert(1)', APP)).toBeUndefined();
    expect(safeRedirect('http://tronbrowser.dev/x', APP)).toBeUndefined(); // http != https origin
  });

  it('rejects empty / nullish input', () => {
    expect(safeRedirect('', APP)).toBeUndefined();
    expect(safeRedirect(undefined, APP)).toBeUndefined();
    expect(safeRedirect(null, APP)).toBeUndefined();
  });
});
