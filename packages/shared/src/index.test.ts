import { describe, it, expect } from 'vitest';
import { telemetryEnabled, ok, err, PRIVACY_PRINCIPLES } from './index.js';

describe('@tronbrowser/shared', () => {
  it('disables telemetry by default', () => {
    expect(telemetryEnabled(undefined)).toBe(false);
    expect(telemetryEnabled(false)).toBe(false);
    expect(telemetryEnabled(true)).toBe(true);
  });

  it('builds discriminated results', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    const e = new Error('x');
    expect(err(e)).toEqual({ ok: false, error: e });
  });

  it('declares the no-telemetry principle', () => {
    expect(PRIVACY_PRINCIPLES).toContain('no-telemetry-by-default');
  });
});
