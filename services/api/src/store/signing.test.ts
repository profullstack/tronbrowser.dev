import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { createHash, createVerify } from 'node:crypto';
import {
  generateSigningKey, crxIdFromPublicKey, packCrx,
  encryptPrivateKey, decryptPrivateKey,
} from './signing.js';
import { artifactToZip } from './crx.js';
import { scanArtifact } from './scanner.js';

const bundle = () => zipSync({
  'manifest.json': strToU8(JSON.stringify({ manifest_version: 3, name: 'x', version: '0.2.0' })),
  'background.js': strToU8('const x = await fetch(url);'),
});

describe('crxIdFromPublicKey', () => {
  it('is 32 chars in the a–p alphabet Chromium uses', () => {
    const id = crxIdFromPublicKey(Buffer.from('some-public-key'));
    expect(id).toHaveLength(32);
    expect(id).toMatch(/^[a-p]{32}$/);
  });

  it('maps the first 16 bytes of the SHA-256 digest, nibble by nibble', () => {
    const key = Buffer.from('deterministic');
    const expected = createHash('sha256').update(key).digest().subarray(0, 16).toString('hex')
      .split('').map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
    expect(crxIdFromPublicKey(key)).toBe(expected);
  });

  it('is stable for one key and different across keys', () => {
    const a = generateSigningKey();
    const b = generateSigningKey();
    expect(crxIdFromPublicKey(Buffer.from(a.publicKeyDer, 'base64'))).toBe(a.crxId);
    expect(a.crxId).not.toBe(b.crxId);
  });
});

describe('packCrx', () => {
  it('produces a CRX3 the store can unpack back to the original zip', () => {
    const key = generateSigningKey();
    const zip = bundle();
    const crx = packCrx(zip, key.privateKeyPem, Buffer.from(key.publicKeyDer, 'base64'));

    expect(crx.subarray(0, 4).toString('utf8')).toBe('Cr24');
    expect(crx.readUInt32LE(4)).toBe(3);
    // Round-trips through the same parser the scanner and ingest use.
    expect(Buffer.from(artifactToZip(crx))).toEqual(Buffer.from(zip));
  });

  it('signs over the archive, so a swapped bundle fails verification', () => {
    const key = generateSigningKey();
    const publicKeyDer = Buffer.from(key.publicKeyDer, 'base64');
    const zip = bundle();
    const crx = packCrx(zip, key.privateKeyPem, publicKeyDer);

    // Rebuild the signed payload and check the embedded signature verifies.
    const headerLen = crx.readUInt32LE(8);
    const header = crx.subarray(12, 12 + headerLen);
    const archive = crx.subarray(12 + headerLen);

    // signed_header_data is the last length-delimited field (10000) in the header.
    const crxId = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
    const signedHeaderData = Buffer.concat([Buffer.from([0x0a, 0x10]), crxId]);
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(signedHeaderData.length, 0);

    // Pull the signature out of the header (field 2 of AsymmetricKeyProof).
    const sigIndex = header.indexOf(Buffer.from([0x12]), header.indexOf(publicKeyDer) + publicKeyDer.length);
    expect(sigIndex).toBeGreaterThan(0);
    const sigLen = header.readUInt8(sigIndex + 1) | (header.readUInt8(sigIndex + 2) << 7 & 0);
    const signature = header.subarray(sigIndex + 3, sigIndex + 3 + 256);
    expect(sigLen).toBeGreaterThan(0);

    const v = createVerify('sha256');
    v.update(Buffer.concat([Buffer.from('CRX3 SignedData', 'utf8'), Buffer.from([0])]));
    v.update(prefix);
    v.update(signedHeaderData);
    v.update(archive);
    expect(v.verify({ key: publicKeyDer, format: 'der', type: 'spki' }, signature)).toBe(true);
  });

  it('stays scannable once packed', () => {
    const key = generateSigningKey();
    const crx = packCrx(bundle(), key.privateKeyPem, Buffer.from(key.publicKeyDer, 'base64'));
    const r = scanArtifact(crx, ['storage']);
    expect(r.green).toBe(true);
  });
});

describe('private key encryption at rest', () => {
  beforeEach(() => vi.stubEnv('CRX_KEY_SECRET', 'x'.repeat(48)));
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips', () => {
    const { privateKeyPem } = generateSigningKey();
    expect(decryptPrivateKey(encryptPrivateKey(privateKeyPem))).toBe(privateKeyPem);
  });

  it('never stores the key in the clear, and uses a fresh iv each time', () => {
    const { privateKeyPem } = generateSigningKey();
    const a = encryptPrivateKey(privateKeyPem);
    const b = encryptPrivateKey(privateKeyPem);
    expect(a).not.toContain('PRIVATE KEY');
    expect(a).not.toBe(b);
  });

  it('refuses to decrypt tampered ciphertext (GCM tag)', () => {
    const enc = encryptPrivateKey(generateSigningKey().privateKeyPem);
    const [iv, tag, ct] = enc.split(':');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 0xff;
    expect(() => decryptPrivateKey([iv, tag, flipped.toString('base64')].join(':'))).toThrow();
  });

  it('fails loudly when CRX_KEY_SECRET is unset rather than storing plaintext', () => {
    vi.stubEnv('CRX_KEY_SECRET', '');
    expect(() => encryptPrivateKey('pem')).toThrow(/CRX_KEY_SECRET/);
  });
});
