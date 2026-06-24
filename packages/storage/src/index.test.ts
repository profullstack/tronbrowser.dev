import { describe, it, expect } from 'vitest';
import { resolveStorageConfig, supportsManagedBackups, ENV } from './index.js';

describe('@tronbrowser/storage config', () => {
  it('uses managed cloud tier (with backups) for *.turso.io', () => {
    const cfg = resolveStorageConfig({
      [ENV.url]: 'libsql://tronbrowser-profullstack.aws-us-west-2.turso.io',
      [ENV.authToken]: 'tok',
    });
    expect(cfg.driver).toBe('turso');
    expect(cfg.tier).toBe('cloud');
    expect(supportsManagedBackups(cfg)).toBe(true);
  });

  it('lets a user point at their own local SQLite file (self-hosted, no managed backups)', () => {
    const cfg = resolveStorageConfig({ [ENV.path]: '/home/u/.tronbrowser/db.sqlite' });
    expect(cfg.driver).toBe('sqlite-file');
    expect(cfg.tier).toBe('self-hosted');
    expect(supportsManagedBackups(cfg)).toBe(false);
  });

  it('treats a file: URL as a local libSQL replica', () => {
    const cfg = resolveStorageConfig({ [ENV.url]: 'file:local.db' });
    expect(cfg.driver).toBe('libsql-local');
    expect(cfg.tier).toBe('self-hosted');
  });

  it('treats a self-run remote libSQL as self-hosted', () => {
    const cfg = resolveStorageConfig({
      [ENV.url]: 'libsql://db.myserver.example',
      [ENV.authToken]: 'tok',
    });
    expect(cfg.tier).toBe('self-hosted');
  });

  it('requires an auth token for remote URLs', () => {
    expect(() => resolveStorageConfig({ [ENV.url]: 'libsql://x.turso.io' })).toThrow(/AUTH_TOKEN/);
  });

  it('errors when nothing is configured', () => {
    expect(() => resolveStorageConfig({})).toThrow(/No storage configured/);
  });
});
