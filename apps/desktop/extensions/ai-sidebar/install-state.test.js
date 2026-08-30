import { describe, expect, it, vi } from 'vitest';
import { decideInstallTarget, lookupInstalled } from './install-state.js';

const CRX = 'https://clients2.google.com/service/update2/crx?x=id%3Dabc';
const TRON = 'https://tronbrowser.dev/api/store/extensions/thing/download';

// The listing that started this: MarkSyncr ships bundled and loaded unpacked, and
// its Web Store manifest carries a `key`, so the bundled copy holds the same id as
// the listing. A CRX cannot install over it, and the prompt never dismisses.
const MARKSYNCR = {
  id: 'hjcjjcpialiakkalcgadnfnoomdaegjg',
  name: 'MarkSyncr',
  version: '0.8.40',
  enabled: true,
  bundled: true,
};

describe('decideInstallTarget', () => {
  it('offers nothing for an extension that is already installed and enabled', () => {
    const t = decideInstallTarget({ installed: MARKSYNCR, tronDownloadUrl: null, crxUrl: CRX });
    expect(t.action).toBe('none');
    expect(t.url).toBeUndefined();
  });

  it('says the copy is bundled when it came from --load-extension', () => {
    const t = decideInstallTarget({ installed: MARKSYNCR, crxUrl: CRX });
    expect(t.label).toContain('Bundled');
    expect(t.title).toContain('MarkSyncr');
  });

  it('distinguishes an extension the user installed themselves', () => {
    const t = decideInstallTarget({ installed: { ...MARKSYNCR, bundled: false }, crxUrl: CRX });
    expect(t.action).toBe('none');
    expect(t.label).toContain('Already in TronBrowser');
  });

  it('refuses to install even when the TronBrowser store also lists it', () => {
    // Being listed in our own store does not make a second install possible: the id
    // is taken either way.
    const t = decideInstallTarget({ installed: MARKSYNCR, tronDownloadUrl: TRON, crxUrl: CRX });
    expect(t.action).toBe('none');
  });

  it('offers to enable, not install, when it is installed but switched off', () => {
    const t = decideInstallTarget({ installed: { ...MARKSYNCR, enabled: false }, crxUrl: CRX });
    expect(t.action).toBe('enable');
    expect(t.id).toBe(MARKSYNCR.id);
    expect(t.label).toContain('Enable');
  });

  it('prefers the TronBrowser store when the extension is absent', () => {
    const t = decideInstallTarget({ installed: null, tronDownloadUrl: TRON, crxUrl: CRX });
    expect(t).toMatchObject({ action: 'navigate', url: TRON });
  });

  it('falls back to the Chrome Web Store CRX when nothing else applies', () => {
    const t = decideInstallTarget({ installed: null, tronDownloadUrl: null, crxUrl: CRX });
    expect(t).toMatchObject({ action: 'navigate', url: CRX });
  });

  it('still offers the CRX install when called with nothing', () => {
    expect(decideInstallTarget().action).toBe('navigate');
  });
});

describe('lookupInstalled', () => {
  it('reports an installed extension', async () => {
    const management = {
      get: vi.fn().mockResolvedValue({
        id: 'abc', name: 'Thing', version: '1.2.3', enabled: true, installType: 'normal',
      }),
    };
    await expect(lookupInstalled('abc', management)).resolves.toEqual({
      id: 'abc', name: 'Thing', version: '1.2.3', enabled: true, bundled: false,
    });
  });

  it('marks a --load-extension copy as bundled', async () => {
    const management = {
      get: vi.fn().mockResolvedValue({ id: 'abc', name: 'T', version: '1', enabled: true, installType: 'development' }),
    };
    await expect(lookupInstalled('abc', management)).resolves.toMatchObject({ bundled: true });
  });

  it('treats a disabled extension as installed', async () => {
    const management = {
      get: vi.fn().mockResolvedValue({ id: 'abc', name: 'T', version: '1', enabled: false, installType: 'normal' }),
    };
    await expect(lookupInstalled('abc', management)).resolves.toMatchObject({ enabled: false });
  });

  it('resolves null when the id is not installed', async () => {
    // management.get rejects for an unknown id; that is the answer, not an error.
    const management = { get: vi.fn().mockRejectedValue(new Error('No extension with id')) };
    await expect(lookupInstalled('abc', management)).resolves.toBeNull();
  });

  it('resolves null rather than hanging when the registry never answers', async () => {
    vi.useFakeTimers();
    try {
      const management = { get: vi.fn().mockImplementation(() => new Promise(() => {})) };
      const p = lookupInstalled('abc', management);
      await vi.advanceTimersByTimeAsync(3000);
      await expect(p).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves null when the management API is missing entirely', async () => {
    await expect(lookupInstalled('abc', undefined)).resolves.toBeNull();
  });

  it('resolves null for a page with no extension id', async () => {
    const management = { get: vi.fn() };
    await expect(lookupInstalled('', management)).resolves.toBeNull();
    expect(management.get).not.toHaveBeenCalled();
  });
});
