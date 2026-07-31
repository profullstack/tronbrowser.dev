import { describe, it, expect } from 'vitest';
import { validateManifest, slugify } from './manifest.js';

const mv3 = {
  manifest_version: 3,
  name: 'Acme Dark Mode',
  version: '1.2.0',
  description: 'A nice dark mode',
  action: { default_title: 'Acme' },
  background: { service_worker: 'bg.js' },
  permissions: ['storage', 'tabs'],
  host_permissions: ['https://example.com/*'],
};

describe('validateManifest', () => {
  it('accepts a well-formed MV3 manifest', () => {
    const v = validateManifest(mv3);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.manifest?.name).toBe('Acme Dark Mode');
    expect(v.slug).toBe('acme-dark-mode');
    expect(v.permissions).toContain('storage');
    expect(v.permissions).toContain('https://example.com/*');
  });

  it('accepts a JSON string', () => {
    expect(validateManifest(JSON.stringify(mv3)).ok).toBe(true);
  });

  it('rejects invalid JSON', () => {
    const v = validateManifest('{ not json');
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/not valid JSON/);
  });

  it('rejects MV2', () => {
    const v = validateManifest({ ...mv3, manifest_version: 2 });
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/manifest_version must be 3/);
  });

  it('rejects missing name/version', () => {
    const v = validateManifest({ manifest_version: 3 });
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/name is required/);
    expect(v.errors.join(' ')).toMatch(/version is required/);
  });

  it('rejects MV2 background and browser_action', () => {
    const v = validateManifest({ ...mv3, background: { scripts: ['bg.js'], persistent: false }, browser_action: {} });
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/service_worker/);
    expect(v.errors.join(' ')).toMatch(/browser_action is MV2/);
  });

  it('warns on sensitive permissions and <all_urls>', () => {
    const v = validateManifest({ ...mv3, permissions: ['debugger', 'cookies'], host_permissions: ['<all_urls>'] });
    expect(v.ok).toBe(true);
    expect(v.warnings.join(' ')).toMatch(/debugger/);
    expect(v.warnings.join(' ')).toMatch(/all URLs/);
  });
});

describe('slugify', () => {
  it('produces url-safe slugs', () => {
    expect(slugify('Hello, World!! 2')).toBe('hello-world-2');
    expect(slugify('   ')).toBe('extension');
  });
});
