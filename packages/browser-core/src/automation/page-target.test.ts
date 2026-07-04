import { describe, expect, it } from 'vitest';
import { resolvePageWsUrl, selectPageTarget } from './page-target.js';
import type { CdpTarget } from './types.js';

const targets: CdpTarget[] = [
  { id: 'sw', type: 'service_worker', url: 'x' },
  { id: 'p1', type: 'page', url: 'https://a', webSocketDebuggerUrl: 'ws://h/p1' },
  { id: 'p2', type: 'page', url: 'https://b', webSocketDebuggerUrl: 'ws://h/p2' },
];

describe('selectPageTarget', () => {
  it('prefers the active tab', () => {
    expect(selectPageTarget(targets, 'p2')?.id).toBe('p2');
  });
  it('falls back to the first page when active is absent/closed', () => {
    expect(selectPageTarget(targets, 'gone')?.id).toBe('p1');
    expect(selectPageTarget(targets)?.id).toBe('p1');
  });
  it('returns undefined when there are no pages', () => {
    expect(selectPageTarget([{ id: 'sw', type: 'service_worker' }])).toBeUndefined();
  });
});

describe('resolvePageWsUrl', () => {
  it('returns the chosen page ws url', () => {
    expect(resolvePageWsUrl(targets, 'p2')).toBe('ws://h/p2');
  });
  it('throws when there is no page target', () => {
    expect(() => resolvePageWsUrl([])).toThrow(/No page target/);
  });
  it('throws when the page has no ws url', () => {
    expect(() => resolvePageWsUrl([{ id: 'p', type: 'page' }])).toThrow(/no webSocketDebuggerUrl/);
  });
});
