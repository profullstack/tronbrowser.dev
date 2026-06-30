import { describe, it, expect } from 'vitest';
import {
  buildLaunchFlags,
  buildTorFlags,
  telemetryEnabled,
  torEnabled,
  incognitoEnabled,
  PRIVACY_FLAGS,
  DEFAULT_TOR_SOCKS_PORT,
} from './chromium-flags.js';

describe('chromium launch flags', () => {
  it('applies privacy flags by default (no telemetry)', () => {
    const flags = buildLaunchFlags();
    expect(telemetryEnabled()).toBe(false);
    for (const f of PRIVACY_FLAGS) {
      expect(flags).toContain(f);
    }
    expect(flags).toContain('--disable-sync');
  });

  it('omits privacy flags only when telemetry is explicitly opted in', () => {
    const flags = buildLaunchFlags({ telemetry: true });
    expect(telemetryEnabled({ telemetry: true })).toBe(true);
    expect(flags).not.toContain('--disable-background-networking');
  });

  it('passes through the user data dir', () => {
    const flags = buildLaunchFlags({ userDataDir: '/home/u/.tronbrowser' });
    expect(flags).toContain('--user-data-dir=/home/u/.tronbrowser');
  });

  it('refuses sponsored / affiliate / ad-injection flags', () => {
    expect(() => buildLaunchFlags({ extraFlags: ['--enable-sponsored-tab'] })).toThrow(
      /forbidden/i,
    );
    expect(() => buildLaunchFlags({ extraFlags: ['--affiliate-rewrite'] })).toThrow();
    expect(() => buildLaunchFlags({ extraFlags: ['--ad-injection'] })).toThrow();
  });
});

describe('tor mode flags', () => {
  it('does not add tor/incognito flags by default', () => {
    const flags = buildLaunchFlags();
    expect(torEnabled()).toBe(false);
    expect(incognitoEnabled()).toBe(false);
    expect(flags.some((f) => f.startsWith('--proxy-server'))).toBe(false);
    expect(flags).not.toContain('--incognito');
  });

  it('routes through the default Tor SOCKS5 port and prevents WebRTC leaks', () => {
    const flags = buildLaunchFlags({ tor: true });
    expect(torEnabled({ tor: true })).toBe(true);
    expect(flags).toContain(`--proxy-server=socks5://127.0.0.1:${DEFAULT_TOR_SOCKS_PORT}`);
    expect(flags).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
    expect(flags).toContain('--proxy-bypass-list=<-loopback>');
  });

  it('honors a custom Tor SOCKS port', () => {
    const flags = buildLaunchFlags({ tor: true, torSocksPort: 9150 });
    expect(flags).toContain('--proxy-server=socks5://127.0.0.1:9150');
    expect(buildTorFlags(9150)[0]).toBe('--proxy-server=socks5://127.0.0.1:9150');
  });

  it('tor implies a fresh incognito window', () => {
    const flags = buildLaunchFlags({ tor: true });
    expect(incognitoEnabled({ tor: true })).toBe(true);
    expect(flags).toContain('--incognito');
  });

  it('lets the caller force incognito off under tor (escape hatch)', () => {
    const flags = buildLaunchFlags({ tor: true, incognito: false });
    expect(incognitoEnabled({ tor: true, incognito: false })).toBe(false);
    expect(flags).not.toContain('--incognito');
  });

  it('supports incognito without tor (opt-in)', () => {
    const flags = buildLaunchFlags({ incognito: true });
    expect(flags).toContain('--incognito');
    expect(flags.some((f) => f.startsWith('--proxy-server'))).toBe(false);
  });

  it('still enforces the forbidden-flag audit in tor mode', () => {
    expect(() =>
      buildLaunchFlags({ tor: true, extraFlags: ['--enable-sponsored-tab'] }),
    ).toThrow(/forbidden/i);
  });
});
