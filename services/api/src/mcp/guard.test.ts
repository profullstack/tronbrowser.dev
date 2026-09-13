import { describe, expect, it } from 'vitest';
import { acceptableUrl, clientKey, isPrivateAddress, RateLimiter } from './guard.js';

describe('isPrivateAddress', () => {
  it('knows the ranges a relay must never reach', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', '::ffff:10.0.0.1', 'ff02::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('acceptableUrl', () => {
  const publicDns = async () => ['93.184.216.34'];
  it('accepts a public https URL after resolving it', async () => {
    const v = await acceptableUrl('https://example.com/a?b=1', publicDns);
    expect(v).toEqual({ ok: true, url: 'https://example.com/a?b=1' });
  });
  it('refuses non-http schemes, credentials, and empty input', async () => {
    expect((await acceptableUrl('ftp://example.com/', publicDns)).ok).toBe(false);
    expect((await acceptableUrl('file:///etc/passwd', publicDns)).ok).toBe(false);
    expect((await acceptableUrl('https://user:pw@example.com/', publicDns)).ok).toBe(false);
    expect((await acceptableUrl('', publicDns)).ok).toBe(false);
    expect((await acceptableUrl(undefined, publicDns)).ok).toBe(false);
    expect((await acceptableUrl('nope', publicDns)).ok).toBe(false);
  });
  it('refuses private names and literal private addresses without resolving', async () => {
    const never = async () => { throw new Error('should not resolve'); };
    for (const url of ['http://localhost:8090/', 'http://api.localhost/', 'http://web.railway.internal/', 'http://printer.local/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/']) {
      const v = await acceptableUrl(url, never);
      expect(v.ok, url).toBe(false);
    }
  });
  it('refuses a public name that resolves to a private address, or does not resolve', async () => {
    const rebinding = async () => ['93.184.216.34', '10.0.0.5'];
    const v = await acceptableUrl('https://evil.example/', rebinding);
    expect(v.ok).toBe(false);
    expect((v as { error: string }).error).toMatch(/private address/);
    const dead = async () => { throw new Error('ENOTFOUND'); };
    expect((await acceptableUrl('https://nope.invalid/', dead)).ok).toBe(false);
    expect((await acceptableUrl('https://nope.invalid/', async () => [])).ok).toBe(false);
  });
});

describe('RateLimiter', () => {
  it('allows a burst, then refills over time, per key', () => {
    let t = 0;
    const rl = new RateLimiter({ burst: 3, perMinute: 60, now: () => t });
    expect([rl.take('a'), rl.take('a'), rl.take('a'), rl.take('a')]).toEqual([true, true, true, false]);
    expect(rl.take('b')).toBe(true); // another caller is unaffected
    t += 1000; // one token a second at 60/min
    expect(rl.take('a')).toBe(true);
    expect(rl.take('a')).toBe(false);
    t += 60_000;
    expect([rl.take('a'), rl.take('a'), rl.take('a'), rl.take('a')]).toEqual([true, true, true, false]); // capped at burst
  });
});

describe('clientKey', () => {
  const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] });
  it('takes the first X-Forwarded-For hop, then X-Real-IP, then unknown', () => {
    expect(clientKey(headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
    expect(clientKey(headers({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(clientKey(headers({}))).toBe('unknown');
  });
});
