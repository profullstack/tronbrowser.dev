import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { crxToZip, extractListingFromCrx } from './crx.js';

// Build a minimal CRX3 (Cr24 + fake header + zip) for testing.
function makeCrx(files: Record<string, Uint8Array>, headerLen = 8): Uint8Array {
  const zip = zipSync(files);
  const head = new Uint8Array(12 + headerLen);
  head.set(strToU8('Cr24'), 0);
  new DataView(head.buffer).setUint32(4, 3, true); // version 3
  new DataView(head.buffer).setUint32(8, headerLen, true);
  const out = new Uint8Array(head.length + zip.length);
  out.set(head, 0);
  out.set(zip, head.length);
  return out;
}

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

describe('crx ingest', () => {
  it('extracts manifest + icon from a crx', () => {
    const manifest = {
      manifest_version: 3,
      name: 'Test Ext',
      version: '1.2.3',
      description: 'A test extension',
      permissions: ['storage'],
      host_permissions: ['https://example.com/*'],
      icons: { '16': 'icons/16.png', '128': 'icons/128.png' },
    };
    const crx = makeCrx({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'icons/128.png': PNG,
      'background.js': strToU8('console.log(1)'),
    });
    const l = extractListingFromCrx(crx);
    expect(l.name).toBe('Test Ext');
    expect(l.version).toBe('1.2.3');
    expect(l.summary).toBe('A test extension');
    expect(l.permissions).toEqual(['storage', 'https://example.com/*']);
    expect(l.iconDataUri).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects a non-crx buffer', () => {
    expect(() => crxToZip(strToU8('not a crx at all'))).toThrow(/Cr24/);
  });

  it('rejects a non-MV3 manifest', () => {
    const crx = makeCrx({ 'manifest.json': strToU8(JSON.stringify({ manifest_version: 2, name: 'x', version: '1' })) });
    expect(() => extractListingFromCrx(crx)).toThrow(/MV3-only/);
  });
});
