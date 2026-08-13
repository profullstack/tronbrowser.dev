import { describe, expect, it, vi } from 'vitest';

import { lookupRemote, RemoteLookupDisabledError, REMOTE_LOOKUP_DISCLOSURE } from './remote.js';

/**
 * This is the one function in the package that tells someone else what the
 * user is looking at. The tests are mostly about it refusing to run.
 */

const PAYLOAD = {
  provenance: {
    strength: 'signed',
    declared_ai_generated: true,
    c2pa: { present: true },
    notes: ['A C2PA manifest is present.'],
  },
};

function okFetch() {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(PAYLOAD), { status: 200 })) as unknown as
    typeof fetch & { mock: { calls: unknown[][] } };
}

describe('refusing to run', () => {
  it('throws when the user has not opted in', async () => {
    const fetchImpl = okFetch();

    await expect(
      lookupRemote('https://example.com/a.png', { enabled: false, apiKey: 'k' }, fetchImpl),
    ).rejects.toThrow(RemoteLookupDisabledError);

    // Nothing left the machine on the way to finding out it was disabled.
    expect(fetchImpl.mock.calls).toHaveLength(0);
  });

  it('throws when opted in but with no key', async () => {
    const fetchImpl = okFetch();

    await expect(
      lookupRemote('https://example.com/a.png', { enabled: true, apiKey: '' }, fetchImpl),
    ).rejects.toThrow(RemoteLookupDisabledError);
    expect(fetchImpl.mock.calls).toHaveLength(0);
  });

  it('treats anything other than an explicit true as off', async () => {
    const fetchImpl = okFetch();

    for (const enabled of [undefined, null, 1, 'yes']) {
      await expect(
        lookupRemote(
          'https://example.com/a.png',
          { enabled: enabled as unknown as boolean, apiKey: 'k' },
          fetchImpl,
        ),
      ).rejects.toThrow(RemoteLookupDisabledError);
    }

    expect(fetchImpl.mock.calls).toHaveLength(0);
  });
});

describe('when the user has opted in', () => {
  it('returns the remote verdict', async () => {
    const verdict = await lookupRemote(
      'https://example.com/a.png',
      { enabled: true, apiKey: 'k' },
      okFetch(),
    );

    expect(verdict?.strength).toBe('signed');
    expect(verdict?.declaredAiGenerated).toBe(true);
    expect(verdict?.c2paPresent).toBe(true);
  });

  it('sends no cookies to the third party', async () => {
    const fetchImpl = okFetch();
    await lookupRemote('https://example.com/a.png', { enabled: true, apiKey: 'k' }, fetchImpl);

    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.credentials).toBe('omit');
  });

  it('defaults to the aiornot.vote endpoint and honours an override', async () => {
    const a = okFetch();
    await lookupRemote('https://example.com/a.png', { enabled: true, apiKey: 'k' }, a);
    expect(String(a.mock.calls[0]![0])).toContain('aiornot.vote');

    const b = okFetch();
    await lookupRemote(
      'https://example.com/a.png',
      { enabled: true, apiKey: 'k', endpoint: 'https://self.hosted/prov' },
      b,
    );
    expect(String(b.mock.calls[0]![0])).toBe('https://self.hosted/prov');
  });

  it('returns null rather than throwing when the service fails', async () => {
    const failing = vi.fn().mockResolvedValue(new Response('', { status: 500 })) as unknown as typeof fetch;

    expect(
      await lookupRemote('https://example.com/a.png', { enabled: true, apiKey: 'k' }, failing),
    ).toBeNull();
  });

  it('returns null on a network fault', async () => {
    const offline = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    expect(
      await lookupRemote('https://example.com/a.png', { enabled: true, apiKey: 'k' }, offline),
    ).toBeNull();
  });

  it('returns null when the response has no provenance block', async () => {
    const empty = vi.fn().mockResolvedValue(new Response('{}', { status: 200 })) as unknown as typeof fetch;

    expect(
      await lookupRemote('https://example.com/a.png', { enabled: true, apiKey: 'k' }, empty),
    ).toBeNull();
  });
});

describe('the disclosure', () => {
  it('says plainly what the third party learns', () => {
    expect(REMOTE_LOOKUP_DISCLOSURE).toMatch(/third-party/i);
    expect(REMOTE_LOOKUP_DISCLOSURE).toMatch(/learn what you are looking at/i);
    expect(REMOTE_LOOKUP_DISCLOSURE).toMatch(/sent nowhere/i);
  });
});
