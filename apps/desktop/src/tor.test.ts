import { describe, it, expect } from 'vitest';
import {
  resolveTorBinary,
  buildTorArgs,
  parseBootstrapProgress,
  isBootstrapComplete,
} from './tor.js';
import { DEFAULT_TOR_SOCKS_PORT } from './chromium-flags.js';

describe('resolveTorBinary', () => {
  it('falls back to the bare command on PATH when no bundled dir', () => {
    expect(resolveTorBinary({ platform: 'linux' })).toBe('tor');
    expect(resolveTorBinary({ platform: 'win32' })).toBe('tor.exe');
  });

  it('resolves a bundled binary path when given a dir', () => {
    expect(resolveTorBinary({ platform: 'linux', bundledDir: '/opt/tron/bin' })).toBe(
      '/opt/tron/bin/tor',
    );
    expect(resolveTorBinary({ platform: 'win32', bundledDir: 'C:\\tron' })).toContain(
      'tor.exe',
    );
  });

  it('throws on an unsupported platform', () => {
    // @ts-expect-error testing the runtime guard
    expect(() => resolveTorBinary({ platform: 'sunos' })).toThrow(/unsupported/i);
  });
});

describe('buildTorArgs', () => {
  it('binds the default SOCKS port to loopback only', () => {
    const args = buildTorArgs();
    const i = args.indexOf('--SocksPort');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe(`127.0.0.1:${DEFAULT_TOR_SOCKS_PORT}`);
  });

  it('honors a custom socks port, data dir, and control port', () => {
    const args = buildTorArgs({ socksPort: 9150, dataDir: '/tmp/tor', controlPort: 9151 });
    expect(args).toContain('--SocksPort');
    expect(args).toContain('127.0.0.1:9150');
    expect(args).toContain('--DataDirectory');
    expect(args).toContain('/tmp/tor');
    expect(args).toContain('--ControlPort');
    expect(args).toContain('127.0.0.1:9151');
  });

  it('omits data dir and control port when unset', () => {
    const args = buildTorArgs({ socksPort: 9050 });
    expect(args).not.toContain('--DataDirectory');
    expect(args).not.toContain('--ControlPort');
  });
});

describe('parseBootstrapProgress', () => {
  it('extracts the percentage from a bootstrap line', () => {
    expect(parseBootstrapProgress('Jun 30 00:00 [notice] Bootstrapped 0% (starting)')).toBe(0);
    expect(parseBootstrapProgress('[notice] Bootstrapped 45% (requesting_descriptors)')).toBe(45);
    expect(parseBootstrapProgress('[notice] Bootstrapped 100% (done)')).toBe(100);
  });

  it('returns null for non-bootstrap lines', () => {
    expect(parseBootstrapProgress('[notice] Opening Socks listener')).toBeNull();
    expect(parseBootstrapProgress('')).toBeNull();
  });

  it('rejects out-of-range percentages', () => {
    expect(parseBootstrapProgress('Bootstrapped 999% (bogus)')).toBeNull();
  });
});

describe('isBootstrapComplete', () => {
  it('is true only at 100%', () => {
    expect(isBootstrapComplete('Bootstrapped 100% (done)')).toBe(true);
    expect(isBootstrapComplete('Bootstrapped 99% (almost)')).toBe(false);
    expect(isBootstrapComplete('not a bootstrap line')).toBe(false);
  });
});
