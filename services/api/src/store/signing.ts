// CRX signing: generate a per-extension key, derive its Chromium id, and pack a
// published .zip into an installable .crx3.
//
// Why the store holds the key: Chromium only installs a signed .crx — a .zip is
// sideload-only (unzip + "Load unpacked"). Asking every publisher to run
// openssl and guard a .pem forever is how listings end up zip-only, which is
// exactly the state this store was in.
//
// The key is the extension's identity: the id is the SHA-256 of the public key,
// so it can never be rotated without orphaning existing installs.
import {
  createCipheriv, createDecipheriv, createHash, createSign,
  generateKeyPairSync, randomBytes, scryptSync,
} from 'node:crypto';

export interface SigningKeyMaterial {
  /** 32-char a-p Chromium extension id, derived from the public key. */
  crxId: string;
  /** base64 SPKI DER. */
  publicKeyDer: string;
  /** PKCS#8 PEM — encrypt before it goes anywhere near storage. */
  privateKeyPem: string;
}

/** Chromium maps the first 16 bytes of SHA-256(SPKI) from hex onto a–p. */
export function crxIdFromPublicKey(publicKeyDer: Buffer): string {
  const digest = createHash('sha256').update(publicKeyDer).digest();
  return [...digest.subarray(0, 16)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .split('')
    .map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16)))
    .join('');
}

export function generateSigningKey(): SigningKeyMaterial {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return {
    crxId: crxIdFromPublicKey(der),
    publicKeyDer: der.toString('base64'),
    privateKeyPem: (privateKey.export({ type: 'pkcs8', format: 'pem' }) as string),
  };
}

/* ---------- encryption at rest ---------- */

function secretKey(): Buffer {
  const secret = process.env.CRX_KEY_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('CRX_KEY_SECRET must be set (32+ random chars) to generate or use signing keys');
  }
  // Fixed salt: the secret is already high-entropy and the DB row is the only
  // ciphertext, so a per-row salt would buy nothing but a schema column.
  return scryptSync(secret, 'tronbrowser-crx-signing', 32);
}

export function encryptPrivateKey(pem: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const ct = Buffer.concat([cipher.update(pem, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptPrivateKey(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('malformed encrypted signing key');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

/* ---------- CRX3 packing ---------- */

// Minimal protobuf writer — the CRX3 header has three fields, so a dependency
// (or generated stubs) would be more machinery than the format needs.
function varint(value: number): Buffer {
  const out: number[] = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return Buffer.from(out);
}

/** Length-delimited (wire type 2) field. */
function field(fieldNumber: number, payload: Buffer): Buffer {
  return Buffer.concat([varint((fieldNumber << 3) | 2), varint(payload.length), payload]);
}

const CRX3_SIGNATURE_CONTEXT = Buffer.concat([Buffer.from('CRX3 SignedData', 'utf8'), Buffer.from([0])]);

/**
 * Wrap a ZIP bundle in a signed CRX3 container.
 *
 * Layout: "Cr24" | uint32le(3) | uint32le(headerLen) | CrxFileHeader | zip
 * The signature covers a context string, the length-prefixed SignedData, and
 * the archive — so the id can't be swapped onto someone else's bundle.
 */
export function packCrx(zip: Uint8Array, privateKeyPem: string, publicKeyDer: Buffer): Buffer {
  const crxId = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  const signedHeaderData = field(1, crxId); // SignedData { bytes crx_id = 1; }

  const signer = createSign('sha256');
  signer.update(CRX3_SIGNATURE_CONTEXT);
  const lengthPrefix = Buffer.alloc(4);
  lengthPrefix.writeUInt32LE(signedHeaderData.length, 0);
  signer.update(lengthPrefix);
  signer.update(signedHeaderData);
  signer.update(Buffer.from(zip));
  const signature = signer.sign(privateKeyPem);

  // AsymmetricKeyProof { public_key = 1; signature = 2; }
  const proof = Buffer.concat([field(1, publicKeyDer), field(2, signature)]);
  // CrxFileHeader { sha256_with_rsa = 2; signed_header_data = 10000; }
  const header = Buffer.concat([field(2, proof), field(10000, signedHeaderData)]);

  const prelude = Buffer.alloc(12);
  prelude.write('Cr24', 0, 'utf8');
  prelude.writeUInt32LE(3, 4);
  prelude.writeUInt32LE(header.length, 8);

  return Buffer.concat([prelude, header, Buffer.from(zip)]);
}
