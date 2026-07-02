import { describe, it, expect } from 'vitest';
import { isBlockedHost } from './ssrf-guard.js';

describe('isBlockedHost', () => {
  it('blocks loopback / unspecified / metadata / private / CGNAT IPv4', () => {
    for (const ip of [
      '127.0.0.1', '127.0.0.2', '127.255.255.255',
      '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.255',
      '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.255',
    ]) {
      expect(isBlockedHost(ip), ip).toBe(true);
    }
  });

  it('blocks loopback / link-local / ULA / mapped IPv6', () => {
    for (const ip of ['::1', '[::1]', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1']) {
      expect(isBlockedHost(ip), ip).toBe(true);
    }
  });

  it('blocks internal hostnames', () => {
    for (const h of ['localhost', 'foo.localhost', 'db.local', 'svc.internal']) {
      expect(isBlockedHost(h), h).toBe(true);
    }
    expect(isBlockedHost('')).toBe(true);
    expect(isBlockedHost(undefined)).toBe(true);
  });

  it('allows public LLM provider hosts and public IPs', () => {
    for (const h of [
      'api.openai.com', 'generativelanguage.googleapis.com', 'api.deepseek.com',
      'example.com', '8.8.8.8', '1.1.1.1',
      '172.15.0.1', '172.32.0.1', '192.169.0.1', '100.63.0.1', '100.128.0.1', '11.0.0.1',
    ]) {
      expect(isBlockedHost(h), h).toBe(false);
    }
  });
});
