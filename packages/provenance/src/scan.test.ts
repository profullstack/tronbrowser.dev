// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

import { attachBadge, fetchHead, inspect, mediaUrl, scanMedia, SCANNED_ATTRIBUTE } from './scan.js';
import { toBadge } from './badge.js';
import { readProvenance } from './read.js';

/**
 * The privacy claim in this package is "no third party learns anything", and
 * the only way that stays true is if the scan never contacts one. These tests
 * assert what is fetched, not just what is rendered.
 */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function bytesOf(...parts: (number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      for (let i = 0; i < part.length; i += 1) out.push(part.charCodeAt(i));
    } else {
      out.push(...part);
    }
  }
  return new Uint8Array(out);
}

/** A response that streams the given bytes. */
function fileResponse(bytes: Uint8Array): Response {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Response(buffer, { status: 206 }) as Response;
}

const AI_XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description Iptc4xmpExt:DigitalSourceType=' +
  '"http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/></x:xmpmeta>';

function stubFetch(bytes: Uint8Array) {
  return vi.fn().mockResolvedValue(fileResponse(bytes)) as unknown as typeof fetch & {
    mock: { calls: unknown[][] };
  };
}

describe('mediaUrl', () => {
  it('reads src, falling back to data-src and a nested source', () => {
    document.body.innerHTML = `
      <img id="a" src="/a.png">
      <img id="b" data-src="/b.png">
      <video id="c"><source src="/c.mp4"></video>
      <img id="d">`;

    expect(mediaUrl(document.getElementById('a')!)).toBe('/a.png');
    expect(mediaUrl(document.getElementById('b')!)).toBe('/b.png');
    expect(mediaUrl(document.getElementById('c')!)).toBe('/c.mp4');
    expect(mediaUrl(document.getElementById('d')!)).toBeNull();
  });

  it('skips data URLs', () => {
    document.body.innerHTML = '<img id="a" src="data:image/gif;base64,R0lGOD">';
    expect(mediaUrl(document.getElementById('a')!)).toBeNull();
  });
});

describe('fetchHead', () => {
  it('range-requests, prefers cache, and sends no cross-site credentials', async () => {
    const fetchImpl = stubFetch(bytesOf(PNG_MAGIC));

    await fetchHead('/a.png', fetchImpl);

    const init = fetchImpl.mock.calls[0]![1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers.Range).toMatch(/^bytes=0-\d+$/);
    expect(init.cache).toBe('force-cache');
    expect(init.credentials).toBe('same-origin');
  });

  it('returns null rather than throwing on a CORS or network failure', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('CORS')) as unknown as typeof fetch;
    expect(await fetchHead('/a.png', failing)).toBeNull();
  });

  it('returns null on a non-success status', async () => {
    const notFound = vi.fn().mockResolvedValue(new Response('', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchHead('/a.png', notFound)).toBeNull();
  });
});

describe('inspect', () => {
  it('reports a declared AI image', async () => {
    document.body.innerHTML = '<img id="a" src="/a.png">';
    const fetchImpl = stubFetch(bytesOf(PNG_MAGIC, AI_XMP));

    const result = await inspect(document.getElementById('a')!, fetchImpl);

    expect(result?.badge.kind).toBe('ai');
    expect(result?.report.declaredAiGenerated).toBe(true);
  });

  it('returns null for an element with nothing to fetch', async () => {
    document.body.innerHTML = '<img id="a">';
    const fetchImpl = stubFetch(bytesOf(PNG_MAGIC));

    expect(await inspect(document.getElementById('a')!, fetchImpl)).toBeNull();
    expect(fetchImpl.mock.calls).toHaveLength(0);
  });
});

describe('scanMedia', () => {
  it('badges a declared AI image and marks the element', async () => {
    document.body.innerHTML = '<img src="/a.png" width="400" height="300">';
    const fetchImpl = stubFetch(bytesOf(PNG_MAGIC, AI_XMP));

    const result = await scanMedia({ fetchImpl });

    expect(result.badged).toBe(1);
    const badge = document.querySelector('.tron-provenance');
    expect(badge?.textContent).toBe('AI-generated');
    expect(document.querySelector('img')?.getAttribute(SCANNED_ATTRIBUTE)).toBe('ai');
  });

  it('leaves ordinary images unbadged', async () => {
    document.body.innerHTML = '<img src="/a.png" width="400" height="300">';
    const fetchImpl = stubFetch(bytesOf(PNG_MAGIC, 'ordinary'));

    const result = await scanMedia({ fetchImpl });

    expect(result.examined).toBe(1);
    expect(result.badged).toBe(0);
    expect(document.querySelector('.tron-provenance')).toBeNull();
  });

  it('shows the quiet findings when asked', async () => {
    document.body.innerHTML = '<img src="/a.png" width="400" height="300">';
    const fetchImpl = stubFetch(bytesOf(PNG_MAGIC, 'ordinary'));

    await scanMedia({ fetchImpl, showAll: true });

    expect(document.querySelector('.tron-provenance')?.textContent).toBe('No provenance');
  });

  it('does not rescan an element it already handled', async () => {
    document.body.innerHTML = '<img src="/a.png" width="400" height="300">';
    const fetchImpl = stubFetch(bytesOf(PNG_MAGIC, AI_XMP));

    await scanMedia({ fetchImpl });
    const second = await scanMedia({ fetchImpl });

    expect(second.examined).toBe(0);
    expect(fetchImpl.mock.calls).toHaveLength(1);
  });

  it('skips icons below the size floor', async () => {
    document.body.innerHTML = '<img src="/icon.png" width="16" height="16">';
    const fetchImpl = stubFetch(bytesOf(PNG_MAGIC, AI_XMP));

    const result = await scanMedia({ fetchImpl });

    expect(result.examined).toBe(0);
    expect(fetchImpl.mock.calls).toHaveLength(0);
  });

  it('still examines an image that has not declared its size', async () => {
    document.body.innerHTML = '<img src="/a.png">';
    const fetchImpl = stubFetch(bytesOf(PNG_MAGIC, AI_XMP));

    expect((await scanMedia({ fetchImpl })).examined).toBe(1);
  });

  it('bounds how many elements one pass will fetch', async () => {
    document.body.innerHTML = Array.from(
      { length: 100 },
      (_, i) => `<img src="/img-${i}.png" width="400">`,
    ).join('');
    const fetchImpl = stubFetch(bytesOf(PNG_MAGIC, AI_XMP));

    const result = await scanMedia({ fetchImpl, maxElements: 5 });

    expect(result.examined).toBe(5);
    expect(fetchImpl.mock.calls).toHaveLength(5);
  });

  it('counts an unreadable image as skipped, not badged', async () => {
    document.body.innerHTML = '<img src="https://other.example/a.png" width="400">';
    const failing = vi.fn().mockRejectedValue(new Error('CORS')) as unknown as typeof fetch;

    const result = await scanMedia({ fetchImpl: failing });

    expect(result.skipped).toBe(1);
    expect(result.badged).toBe(0);
    expect(document.querySelector('img')?.getAttribute(SCANNED_ATTRIBUTE)).toBe('unreadable');
  });

  it('only ever fetches the URLs already on the page', async () => {
    document.body.innerHTML = '<img src="/a.png" width="400">';
    const fetchImpl = stubFetch(bytesOf(PNG_MAGIC, AI_XMP));

    await scanMedia({ fetchImpl });

    // No third-party service is contacted by a local scan, ever.
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual(['/a.png']);
  });

  it('reports each result to the caller', async () => {
    document.body.innerHTML = '<img src="/a.png" width="400">';
    const seen: string[] = [];

    await scanMedia({
      fetchImpl: stubFetch(bytesOf(PNG_MAGIC, AI_XMP)),
      onResult: (_element, _report, badge) => seen.push(badge.kind),
    });

    expect(seen).toEqual(['ai']);
  });

  it('scans only inside the given root', async () => {
    document.body.innerHTML =
      '<div id="inside"><img src="/a.png" width="400"></div><img src="/b.png" width="400">';
    const fetchImpl = stubFetch(bytesOf(PNG_MAGIC, AI_XMP));

    await scanMedia({ fetchImpl, root: document.getElementById('inside')! });

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual(['/a.png']);
  });
});

describe('attachBadge', () => {
  it('inserts beside the element, since img cannot hold children', () => {
    document.body.innerHTML = '<img id="a" src="/a.png">';
    const image = document.getElementById('a')!;

    const badge = attachBadge(image, toBadge(readProvenance(bytesOf(PNG_MAGIC, AI_XMP))));

    expect(image.nextSibling).toBe(badge);
    expect(image.children).toHaveLength(0);
  });

  it('puts the caveat where a screen reader will reach it', () => {
    document.body.innerHTML = '<img id="a" src="/a.png">';
    const badge = attachBadge(
      document.getElementById('a')!,
      toBadge(readProvenance(bytesOf(PNG_MAGIC, AI_XMP))),
    );

    // A hover-only tooltip would hide the part that stops it overclaiming.
    expect(badge.getAttribute('aria-label')).toMatch(/AI-generated\./);
    expect(badge.getAttribute('aria-label')).toMatch(/not a signature/i);
    expect(badge.getAttribute('role')).toBe('note');
    expect(badge.getAttribute('tabindex')).toBe('0');
  });

  it('classes the badge by kind for styling', () => {
    document.body.innerHTML = '<img id="a" src="/a.png">';
    const badge = attachBadge(
      document.getElementById('a')!,
      toBadge(readProvenance(bytesOf(PNG_MAGIC, AI_XMP))),
    );

    expect(badge.className).toBe('tron-provenance tron-provenance--ai');
  });
});
