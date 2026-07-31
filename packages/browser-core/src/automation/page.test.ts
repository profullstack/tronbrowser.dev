import { describe, expect, it, vi } from 'vitest';
import type { CdpConnection } from './cdp-client.js';
import {
  captureSnapshot,
  clickRef,
  fillRef,
  formatSnapshotText,
  StaleRefError,
} from './page.js';
import type { AgentSnapshot } from './snapshot-script.js';

/** A CdpConnection whose Runtime.evaluate returns a canned by-value result. */
function fakeConn(evalValue: unknown, opts: { exception?: string } = {}): CdpConnection {
  const send = vi.fn(async (method: string) => {
    if (method === 'Runtime.evaluate') {
      return opts.exception
        ? { exceptionDetails: { text: opts.exception } }
        : { result: { value: evalValue } };
    }
    return {};
  });
  return { send: send as unknown as CdpConnection['send'], on: vi.fn(), close: vi.fn() };
}

const snap: AgentSnapshot = {
  url: 'https://example.com/contact',
  title: 'Contact Us',
  timestamp: '2026-07-04T00:00:00.000Z',
  elements: [
    { ref: '@e1', role: 'heading', name: 'Contact Us', tag: 'h1', interactive: false, visible: true },
    { ref: '@e2', role: 'textbox', name: 'Email', tag: 'input', interactive: true, visible: true, value: 'a@b.com' },
    { ref: '@e3', role: 'link', name: 'More', tag: 'a', interactive: true, visible: true, href: 'https://x/y' },
  ],
};

describe('captureSnapshot', () => {
  it('returns the page-provided snapshot value', async () => {
    const result = await captureSnapshot(fakeConn(snap));
    expect(result.title).toBe('Contact Us');
    expect(result.elements).toHaveLength(3);
  });

  it('throws when the page evaluation raises', async () => {
    await expect(captureSnapshot(fakeConn(null, { exception: 'boom' }))).rejects.toThrow(
      /Page evaluation failed: boom/,
    );
  });
});

describe('ref actions', () => {
  it('clickRef returns the action result', async () => {
    const res = await clickRef(fakeConn({ ok: true, ref: '@e3' }), '@e3');
    expect(res.ok).toBe(true);
  });

  it('clickRef throws StaleRefError when the ref is gone', async () => {
    await expect(
      clickRef(fakeConn({ ok: false, error: 'STALE_REF', ref: '@e9' }), '@e9'),
    ).rejects.toBeInstanceOf(StaleRefError);
  });

  it('fillRef throws StaleRefError when the ref is gone', async () => {
    const err = await fillRef(
      fakeConn({ ok: false, error: 'STALE_REF', ref: '@e9' }),
      '@e9',
      'x',
    ).catch((e) => e);
    expect(err).toBeInstanceOf(StaleRefError);
    expect(err.recoverable).toBe(true);
    expect(err.code).toBe('STALE_REF');
  });

  it('rejects a malformed ref before touching the page', async () => {
    await expect(clickRef(fakeConn({}), 'not-a-ref')).rejects.toThrow(/snapshot ref/);
  });
});

describe('formatSnapshotText', () => {
  it('renders compact ref lines with value and href hints', () => {
    const text = formatSnapshotText(snap);
    expect(text).toContain('Page: Contact Us');
    expect(text).toContain('URL: https://example.com/contact');
    expect(text).toContain('@e1 heading "Contact Us"');
    expect(text).toContain('@e2 textbox "Email" = "a@b.com"');
    expect(text).toContain('@e3 link "More" -> https://x/y');
  });

  it('notes when there are no interactive elements', () => {
    const text = formatSnapshotText({ ...snap, elements: [] });
    expect(text).toContain('(no interactive elements)');
  });
});
