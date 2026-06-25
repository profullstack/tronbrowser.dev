import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';

export const token = () => randomBytes(32).toString('base64url');
export const uuid = () => randomUUID();

/** scrypt password hash: salt:hash (hex). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

export const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
export const EMAIL_TOKEN_TTL = 60 * 60 * 24; // 24h
