import { describe, it, expect } from 'vitest';
import { buildTorProxyConfig } from './tor-proxy.js';
import { DEFAULT_TOR_SOCKS_PORT } from './chromium-flags.js';

describe('buildTorProxyConfig', () => {
  it('routes all traffic through the default Tor SOCKS5 proxy', () => {
    const cfg = buildTorProxyConfig();
    expect(cfg.mode).toBe('fixed_servers');
    expect(cfg.rules.singleProxy).toEqual({
      scheme: 'socks5',
      host: '127.0.0.1',
      port: DEFAULT_TOR_SOCKS_PORT,
    });
  });

  it('uses SOCKS5 (remote DNS — no .onion/DNS leak) and bypasses loopback', () => {
    const cfg = buildTorProxyConfig();
    expect(cfg.rules.singleProxy.scheme).toBe('socks5');
    // Loopback must skip Tor — Tor rejects connections to private addresses, so
    // routing localhost through it would break the local control channel.
    expect(cfg.rules.bypassList).toContain('127.0.0.1');
    expect(cfg.rules.bypassList).toContain('localhost');
  });

  it('honors a custom SOCKS port', () => {
    expect(buildTorProxyConfig(9150).rules.singleProxy.port).toBe(9150);
  });
});
