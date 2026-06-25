// End-to-end vault (web) — AES-256-GCM, PBKDF2-SHA256 key from a passphrase that
// never leaves the browser. The server stores only ciphertext. Mirrors the
// extension's vault.js so an encrypted blob round-trips between web + extension.
const ENC = new TextEncoder();
const DEC = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', ENC.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function encryptVault(passphrase, obj) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, ENC.encode(JSON.stringify(obj)));
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

export async function decryptVault(passphrase, blob) {
  if (!blob || !blob.ct) return null;
  const key = await deriveKey(passphrase, unb64(blob.salt));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return JSON.parse(DEC.decode(pt));
}
