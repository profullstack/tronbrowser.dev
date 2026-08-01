import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { crxToZip, extractListingFromCrx, stampUpdateUrl } from './crx.js';

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

describe('stampUpdateUrl', () => {
  const FEED = 'https://tronbrowser.dev/api/store/updates.xml?id=abc';
  const bundle = (manifest: object, extra: Record<string, Uint8Array> = {}) =>
    zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), ...extra });
  const manifestOf = (zip: Uint8Array) =>
    JSON.parse(strFromU8(unzipSync(zip)['manifest.json']));

  it('adds update_url to a manifest that has none', () => {
    // The CoinPay Wallet case: a valid MV3 bundle that never opted into the
    // store's feed, so the install could never move off its first version.
    const out = stampUpdateUrl(bundle({ manifest_version: 3, name: 'CoinPay Wallet', version: '0.9.2' }), FEED);
    expect(manifestOf(out).update_url).toBe(FEED);
  });

  it('overwrites a publisher update_url that points elsewhere', () => {
    // Only our feed can serve an update for an id derived from our signing key.
    const out = stampUpdateUrl(bundle({ manifest_version: 3, name: 'x', version: '1', update_url: 'https://clients2.google.com/service/update2/crx' }), FEED);
    expect(manifestOf(out).update_url).toBe(FEED);
  });

  it('keeps every other file and manifest field intact', () => {
    const out = stampUpdateUrl(
      bundle({ manifest_version: 3, name: 'x', version: '1', permissions: ['storage'] }, { 'sw.js': strToU8('console.log(1)') }),
      FEED,
    );
    const files = unzipSync(out);
    expect(strFromU8(files['sw.js'])).toBe('console.log(1)');
    expect(manifestOf(out).permissions).toEqual(['storage']);
    expect(manifestOf(out).version).toBe('1');
  });

  it('returns the original bytes when the feed is already ours', () => {
    const zip = bundle({ manifest_version: 3, name: 'x', version: '1', update_url: FEED });
    expect(stampUpdateUrl(zip, FEED)).toBe(zip);
  });

  it('rejects a bundle with no manifest', () => {
    expect(() => stampUpdateUrl(zipSync({ 'sw.js': strToU8('x') }), FEED)).toThrow(/no manifest\.json/);
  });
});
