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
  /** PKCS#8 PEM — seal (sealPrivateKey) before it goes anywhere near storage. */
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

/* ---------- sealing (seal v2) ----------
   The store holds no key that opens a signing key. Each publisher has a seal
   record (apps/extensions/public/seal.js): passphrase -> PBKDF2 600k -> HKDF
   -> KEK, which wraps a random data key (DEK). The browser/script derives the
   DEK and sends it with the one request that needs the signing key (create,
   migrate, sign a release); the key is opened inside that request and dropped.
   private_key_enc = "v2:" iv:tag:ciphertext under the DEK, AAD binds the
   publisher and the extension. */

export interface PublisherSeal {
  v: 2;
  kdf: { alg: 'PBKDF2-SHA256'; iterations: number; salt: string };
  wrapped_dek: { ciphertext: string; iv: string; tag: string };
  recovery_wrapped_dek: { ciphertext: string; iv: string; tag: string } | null;
  key_check: { ciphertext: string; iv: string; tag: string };
}

const KEY_CHECK = 'tronbrowser-key-check-v2';

function isBlob(v: unknown): v is { ciphertext: string; iv: string; tag: string } {
  const b = v as Record<string, unknown> | null;
  return !!b && typeof b.ciphertext === 'string' && typeof b.iv === 'string' && typeof b.tag === 'string';
}

export function isPublisherSeal(v: unknown): v is PublisherSeal {
  const s = v as Record<string, any> | null;
  return !!s && s.v === 2 && s.kdf?.alg === 'PBKDF2-SHA256' && Number(s.kdf?.iterations) >= 600_000
    && typeof s.kdf?.salt === 'string' && isBlob(s.wrapped_dek) && isBlob(s.key_check)
    && (s.recovery_wrapped_dek === null || isBlob(s.recovery_wrapped_dek));
}

function aad(userId: string, field: string): Buffer {
  return Buffer.from(`tronbrowser:v2:${userId}:${field}`, 'utf8');
}

/** True when `dek` (32 bytes) is this publisher's data key. */
export function verifyDataKey(dek: Buffer, seal: PublisherSeal, userId: string): boolean {
  if (dek.length !== 32) return false;
  try {
    const d = createDecipheriv('aes-256-gcm', dek, Buffer.from(seal.key_check.iv, 'base64'), { authTagLength: 16 });
    d.setAAD(aad(userId, 'key_check'));
    d.setAuthTag(Buffer.from(seal.key_check.tag, 'base64'));
    const out = Buffer.concat([d.update(Buffer.from(seal.key_check.ciphertext, 'base64')), d.final()]);
    return out.toString('utf8') === KEY_CHECK;
  } catch {
    return false;
  }
}

export function isSealedKey(stored: string): boolean {
  return stored.startsWith('v2:');
}

export function sealPrivateKey(pem: string, dek: Buffer, userId: string, extensionId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, iv, { authTagLength: 16 });
  cipher.setAAD(aad(userId, `signing_key:${extensionId}`));
  const ct = Buffer.concat([cipher.update(pem, 'utf8'), cipher.final()]);
  return 'v2:' + [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function openPrivateKey(stored: string, dek: Buffer, userId: string, extensionId: string): string {
  if (!isSealedKey(stored)) throw new Error('signing key is not sealed yet (migrate it first)');
  const [ivB64, tagB64, ctB64] = stored.slice(3).split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('malformed sealed signing key');
  const d = createDecipheriv('aes-256-gcm', dek, Buffer.from(ivB64, 'base64'), { authTagLength: 16 });
  d.setAAD(aad(userId, `signing_key:${extensionId}`));
  d.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ctB64, 'base64')), d.final()]).toString('utf8');
}

/* ---------- legacy (CRX_KEY_SECRET) ----------
   Readable ONLY by the publisher's one-shot migration and the one-time
   pre-pack of already-published releases (scripts/prepack-legacy-crx). Off
   when LEGACY_KEY_MIGRATION=off; the key itself stays in env until Anthony's
   dated cutoff. */

export function legacyMigrationEnabled(): boolean {
  const v = (process.env.LEGACY_KEY_MIGRATION ?? 'on').trim().toLowerCase();
  return !(v === 'off' || v === '0' || v === 'false');
}

function legacySecretKey(): Buffer {
  const secret = process.env.CRX_KEY_SECRET;
  if (!secret || secret.length < 16) throw new Error('legacy CRX_KEY_SECRET is not set');
  return scryptSync(secret, 'tronbrowser-crx-signing', 32);
}

/** Test fixture only: a legacy-format ciphertext. */
export function legacyEncryptForTests(pem: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', legacySecretKey(), iv);
  const ct = Buffer.concat([cipher.update(pem, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function legacyDecryptPrivateKey(stored: string): string {
  if (!legacyMigrationEnabled()) throw new Error('legacy key migration is off');
  const [ivB64, tagB64, ctB64] = stored.split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('malformed encrypted signing key');
  const decipher = createDecipheriv('aes-256-gcm', legacySecretKey(), Buffer.from(ivB64, 'base64'), { authTagLength: 16 });
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
