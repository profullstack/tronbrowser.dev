import { describe, expect, it } from 'vitest';
import {
  cdpActivateTabUrl,
  cdpBaseUrl,
  cdpCloseTabUrl,
  cdpListUrl,
  cdpNewTabUrl,
  cdpVersionUrl,
  mapTargetsToTabs,
  selectCurrentTab,
} from './cdp.js';
import type { CdpTarget } from './types.js';

const endpoint = { host: '127.0.0.1', port: 9222 };

describe('CDP endpoint URLs', () => {
  it('builds loopback DevTools URLs', () => {
    expect(cdpBaseUrl(endpoint)).toBe('http://127.0.0.1:9222');
    expect(cdpVersionUrl(endpoint)).toBe('http://127.0.0.1:9222/json/version');
    expect(cdpListUrl(endpoint)).toBe('http://127.0.0.1:9222/json/list');
  });

  it('appends the raw URL to /json/new so Chromium can decode it', () => {
    expect(cdpNewTabUrl(endpoint, 'https://example.com/contact')).toBe(
      'http://127.0.0.1:9222/json/new?https://example.com/contact',
    );
  });

  it('targets close/activate by id', () => {
    expect(cdpCloseTabUrl(endpoint, 'ABC123')).toBe(
      'http://127.0.0.1:9222/json/close/ABC123',
    );
    expect(cdpActivateTabUrl(endpoint, 'ABC123')).toBe(
      'http://127.0.0.1:9222/json/activate/ABC123',
    );
  });
});

describe('mapTargetsToTabs', () => {
  const targets: CdpTarget[] = [
    { id: 'w1', type: 'service_worker', url: 'chrome-extension://x/sw.js' },
    { id: 'p1', type: 'page', title: 'First', url: 'https://a.example' },
    { id: 'p2', type: 'page', title: 'Second', url: 'https://b.example' },
  ];

  it('surfaces only page targets', () => {
    const tabs = mapTargetsToTabs(targets);
    expect(tabs.map((t) => t.id)).toEqual(['p1', 'p2']);
  });

  it('marks the first page current when no active tab is set', () => {
    const tabs = mapTargetsToTabs(targets);
    expect(tabs.find((t) => t.current)?.id).toBe('p1');
  });

  it('marks the active tab current when it is still present', () => {
    const tabs = mapTargetsToTabs(targets, 'p2');
    expect(tabs.find((t) => t.current)?.id).toBe('p2');
    expect(tabs.filter((t) => t.current)).toHaveLength(1);
  });

  it('falls back to the first page when the active tab has closed', () => {
    const tabs = mapTargetsToTabs(targets, 'gone');
    expect(tabs.find((t) => t.current)?.id).toBe('p1');
  });

  it('defaults missing title/url to empty strings', () => {
    const tabs = mapTargetsToTabs([{ id: 'p1', type: 'page' }]);
    expect(tabs[0]).toEqual({ id: 'p1', title: '', url: '', current: true });
  });
});

describe('selectCurrentTab', () => {
  it('returns the marked tab', () => {
    const tab = selectCurrentTab([
      { id: 'p1', url: '', title: '', current: false },
      { id: 'p2', url: '', title: '', current: true },
    ]);
    expect(tab?.id).toBe('p2');
  });

  it('falls back to the first tab when none is marked', () => {
    const tab = selectCurrentTab([
      { id: 'p1', url: '', title: '', current: false },
      { id: 'p2', url: '', title: '', current: false },
    ]);
    expect(tab?.id).toBe('p1');
  });

  it('returns undefined for an empty list', () => {
    expect(selectCurrentTab([])).toBeUndefined();
  });
});
