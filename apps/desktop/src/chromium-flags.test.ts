import { describe, it, expect } from 'vitest';
import {
  buildLaunchFlags,
  telemetryEnabled,
  PRIVACY_FLAGS,
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
