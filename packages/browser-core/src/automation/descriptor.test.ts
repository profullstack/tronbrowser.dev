import { describe, expect, it } from 'vitest';
import {
  descriptorPath,
  parseDescriptor,
  resolveDataDir,
  serializeDescriptor,
} from './descriptor.js';
import type { SessionDescriptor } from './types.js';

const base: SessionDescriptor = {
  version: 1,
  pid: 4242,
  host: '127.0.0.1',
  port: 9222,
  profileDir: '/home/u/.tronbrowser-agent',
  profileName: 'agent',
  headless: false,
  ephemeral: false,
  createdAt: '2026-07-04T00:00:00.000Z',
};

describe('resolveDataDir', () => {
  it('prefers TRONBROWSER_DATA', () => {
    expect(resolveDataDir({ TRONBROWSER_DATA: '/custom', HOME: '/home/u' })).toBe('/custom');
  });

  it('falls back to $HOME/.tronbrowser', () => {
    expect(resolveDataDir({ HOME: '/home/u' })).toBe('/home/u/.tronbrowser');
  });

  it('ignores an empty TRONBROWSER_DATA', () => {
    expect(resolveDataDir({ TRONBROWSER_DATA: '', HOME: '/home/u' })).toBe(
      '/home/u/.tronbrowser',
    );
  });
});

describe('descriptorPath', () => {
  it('nests the descriptor under automation/', () => {
    expect(descriptorPath('/home/u/.tronbrowser')).toBe(
      '/home/u/.tronbrowser/automation/session.json',
    );
  });
});

describe('serialize/parse round-trip', () => {
  it('omits absent optionals and round-trips', () => {
    const raw = serializeDescriptor(base);
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).not.toContain('webSocketDebuggerUrl');
    expect(raw).not.toContain('activeTabId');
    expect(parseDescriptor(raw)).toEqual(base);
  });

  it('preserves present optionals', () => {
    const full: SessionDescriptor = {
      ...base,
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc',
      activeTabId: 'p2',
    };
    expect(parseDescriptor(serializeDescriptor(full))).toEqual(full);
  });
});

describe('parseDescriptor validation', () => {
  it('rejects non-JSON', () => {
    expect(() => parseDescriptor('not json')).toThrow(/not valid JSON/);
  });

  it('rejects an unknown schema version', () => {
    expect(() => parseDescriptor(JSON.stringify({ ...base, version: 2 }))).toThrow(
      /version/,
    );
  });

  it('rejects a non-integer pid', () => {
    expect(() => parseDescriptor(JSON.stringify({ ...base, pid: 'x' }))).toThrow(/pid/);
  });

  it('rejects a wrong-typed optional', () => {
    expect(() =>
      parseDescriptor(JSON.stringify({ ...base, activeTabId: 5 })),
    ).toThrow(/activeTabId/);
  });
});
