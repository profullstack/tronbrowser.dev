import { describe, expect, it } from 'vitest';
import { PIT_SOCKS_PORT, buildPitPac, pitProxyConfig } from './pit-proxy.js';

// Run the PAC the way Chromium would: only the PAC helpers exist, and
// dnsResolve is the system resolver — here a stub that knows two clearnet hosts.
function findProxy(host, resolvable = ['example.com', 'www.github.io']) {
  const dnsResolve = (h) => (resolvable.includes(h) ? '93.184.216.34' : null);
  const find = new Function('dnsResolve', `${buildPitPac()}; return FindProxyForURL;`)(dnsResolve);
  return find(`http://${host}/`, host);
}

describe('buildPitPac', () => {
  it('sends a host the system resolver has no answer for to the pit resolver', () => {
    expect(findProxy('scrambled.eggs')).toBe(`SOCKS5 127.0.0.1:${PIT_SOCKS_PORT}`);
    expect(findProxy('anything.moshpit')).toBe(`SOCKS5 127.0.0.1:${PIT_SOCKS_PORT}`);
  });

  it('leaves a host the system resolver knows untouched (clearnet wins)', () => {
    expect(findProxy('example.com')).toBe('DIRECT');
    // .io is claimed as a Moshpit ending too; a name that resolves still goes direct.
    expect(findProxy('www.github.io')).toBe('DIRECT');
  });

  it('never routes loopback, intranet names or IP literals through the pit', () => {
    expect(findProxy('localhost')).toBe('DIRECT');
    expect(findProxy('app.localhost')).toBe('DIRECT');
    expect(findProxy('intranet')).toBe('DIRECT');
    expect(findProxy('127.0.0.1')).toBe('DIRECT');
    expect(findProxy('10.0.0.7')).toBe('DIRECT');
    expect(findProxy('::1')).toBe('DIRECT');
    expect(findProxy('')).toBe('DIRECT');
  });

  it('normalises case and a trailing dot before deciding', () => {
    expect(findProxy('Example.COM.')).toBe('DIRECT');
    expect(findProxy('Mosh.EGGS.')).toBe(`SOCKS5 127.0.0.1:${PIT_SOCKS_PORT}`);
  });

  it('uses the port it is given and refuses a bad one', () => {
    expect(buildPitPac(1234)).toContain('SOCKS5 127.0.0.1:1234');
    expect(() => buildPitPac(0)).toThrow(/bad pit port/);
    expect(() => buildPitPac(70000)).toThrow(/bad pit port/);
    expect(() => buildPitPac('nope')).toThrow(/bad pit port/);
  });
});

describe('pitProxyConfig', () => {
  it('is a non-mandatory inline PAC, so a broken script falls back to DIRECT', () => {
    const cfg = pitProxyConfig();
    expect(cfg.mode).toBe('pac_script');
    expect(cfg.pacScript.data).toContain('function FindProxyForURL');
    expect(cfg.pacScript.mandatory).toBeUndefined();
    expect(cfg.pacScript.url).toBeUndefined();
  });
});
