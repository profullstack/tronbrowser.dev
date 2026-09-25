import { describe, expect, it } from 'vitest';
import { databaseUrl, expiresAt } from './db.js';

describe('databaseUrl', () => {
  it('accepts postgres:// and postgresql://, DATABASE_URL first', () => {
    expect(databaseUrl({ DATABASE_URL: 'postgres://u:p@h:5432/d' })).toBe('postgres://u:p@h:5432/d');
    expect(databaseUrl({ TRONBROWSER_DB_URL: 'postgresql://u:p@h/d' })).toBe('postgresql://u:p@h/d');
    expect(databaseUrl({ DATABASE_URL: 'postgres://a/x', TRONBROWSER_DB_URL: 'postgres://b/y' })).toBe('postgres://a/x');
  });

  it('fails fast when nothing is set, and names a leftover file path', () => {
    expect(() => databaseUrl({})).toThrow(/DATABASE_URL is not set/);
    expect(() => databaseUrl({ TRONBROWSER_DB_PATH: '/data/db.sqlite' })).toThrow(/TRONBROWSER_DB_PATH is set but file databases/);
  });

  it('refuses libsql:// and file: rather than falling back', () => {
    expect(() => databaseUrl({ DATABASE_URL: 'libsql://x.turso.io' })).toThrow(/got "libsql:"/);
    expect(() => databaseUrl({ TRONBROWSER_DB_URL: 'file:local.db' })).toThrow(/got "file:"/);
  });
});

describe('expiresAt', () => {
  it('is an ISO instant ttl seconds ahead', () => {
    expect(expiresAt(3600, Date.UTC(2026, 0, 1))).toBe('2026-01-01T01:00:00.000Z');
  });
});
