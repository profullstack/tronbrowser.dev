/*
 * Publisher key seal (seal v2) — browser + node (WebCrypto only), no build step.
 *
 * Your CRX signing keys are sealed under a passphrase only you know:
 *   passphrase --PBKDF2-SHA256 600k, random 16-byte salt--> HKDF --> KEK
 *   KEK wraps a random 32-byte data key (DEK); a one-time recovery key wraps it too
 *   DEK seals a fixed string (key check)
 * The store keeps only that record. To create a key, migrate one or sign a
 * release, this page derives the DEK locally and sends the DEK (never the
 * passphrase) with that one request; the store opens the signing key inside
 * the request, packs the .crx and forgets it.
 *
 * Classic script: sets globalThis.TronSeal (store.js uses it; scripts import it).
 */
(function (root) {
  'use strict';
  const ITER = 600000;
  const MIN_PASSPHRASE = 10;
  const CHECK = 'tronbrowser-key-check-v2';
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const subtle = () => root.crypto.subtle;

  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(t) {
    const s = atob(t);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function rand(n) {
    const out = new Uint8Array(n);
    root.crypto.getRandomValues(out);
    return out;
  }
  function aad(userId, field) {
    return enc.encode('tronbrowser:v2:' + userId + ':' + field);
  }
  async function gcmEnc(key, pt, ad) {
    const iv = rand(12);
    const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: ad, tagLength: 128 }, key, pt));
    return { ciphertext: b64(sealed.slice(0, sealed.length - 16)), iv: b64(iv), tag: b64(sealed.slice(sealed.length - 16)) };
  }
  async function gcmDec(key, blob, ad) {
    const ct = unb64(blob.ciphertext);
    const tag = unb64(blob.tag);
    const joined = new Uint8Array(ct.length + tag.length);
    joined.set(ct, 0);
    joined.set(tag, ct.length);
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(blob.iv), additionalData: ad, tagLength: 128 }, key, joined));
  }
  async function hkdfKey(ikm, salt, info) {
    const base = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function kek(passphrase, kdf) {
    if (kdf.alg !== 'PBKDF2-SHA256' || kdf.iterations < ITER) throw new Error('unsupported kdf');
    const salt = unb64(kdf.salt);
    const pw = await subtle().importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: kdf.iterations }, pw, 256));
    try { return await hkdfKey(bits, salt, 'tronbrowser/kek/v2'); } finally { bits.fill(0); }
  }
  const B32 = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
  function encodeRecovery(raw) {
    let bits = 0, value = 0, out = '';
    for (const b of raw) {
      value = (value << 8) | b; bits += 8;
      while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out.match(/.{1,4}/g).join('-');
  }
  function decodeRecovery(text) {
    const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let bits = 0, value = 0; const out = [];
    for (const ch of clean) {
      const idx = B32.indexOf(ch);
      if (idx < 0) throw new Error('invalid recovery key');
      value = ((value << 5) | idx) & 0xffff; bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
    }
    if (out.length < 32) throw new Error('invalid recovery key');
    return new Uint8Array(out.slice(0, 32));
  }
  async function recoveryKek(text) {
    const raw = decodeRecovery(text);
    try { return await hkdfKey(raw, enc.encode('tronbrowser/recovery'), 'tronbrowser/recovery-kek/v2'); } finally { raw.fill(0); }
  }
  async function dekKey(dek) {
    return subtle().importKey('raw', dek, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  async function checkDek(dek, seal, userId) {
    try { return dec.decode(await gcmDec(await dekKey(dek), seal.key_check, aad(userId, 'key_check'))) === CHECK; } catch { return false; }
  }

  /** First-time setup. Returns { seal, dek (base64), recoveryKey (show once) }. */
  async function createSeal(passphrase, userId) {
    if (passphrase.length < MIN_PASSPHRASE) throw new Error('passphrase must be at least ' + MIN_PASSPHRASE + ' characters');
    const dek = rand(32);
    const rraw = rand(32);
    const recoveryKey = encodeRecovery(rraw);
    rraw.fill(0);
    const kdf = { alg: 'PBKDF2-SHA256', iterations: ITER, salt: b64(rand(16)) };
    const seal = {
      v: 2,
      kdf,
      wrapped_dek: await gcmEnc(await kek(passphrase, kdf), dek, aad(userId, 'dek:passphrase')),
      recovery_wrapped_dek: await gcmEnc(await recoveryKek(recoveryKey), dek, aad(userId, 'dek:recovery')),
      key_check: await gcmEnc(await dekKey(dek), enc.encode(CHECK), aad(userId, 'key_check')),
    };
    const out = { seal, dek: b64(dek), recoveryKey };
    dek.fill(0);
    return out;
  }

  /** Passphrase (or recovery key with {recovery:true}) -> DEK (base64). */
  async function unlock(seal, secret, userId, opts) {
    let dek;
    try {
      dek = opts && opts.recovery
        ? await gcmDec(await recoveryKek(secret), seal.recovery_wrapped_dek, aad(userId, 'dek:recovery'))
        : await gcmDec(await kek(secret, seal.kdf), seal.wrapped_dek, aad(userId, 'dek:passphrase'));
    } catch {
      throw Object.assign(new Error(opts && opts.recovery ? 'wrong recovery key' : 'wrong passphrase'), { name: 'WrongPassphraseError' });
    }
    if (!(await checkDek(dek, seal, userId))) throw Object.assign(new Error('wrong passphrase'), { name: 'WrongPassphraseError' });
    const out = b64(dek);
    dek.fill(0);
    return out;
  }

  root.TronSeal = { createSeal, unlock, MIN_PASSPHRASE };
})(globalThis);
