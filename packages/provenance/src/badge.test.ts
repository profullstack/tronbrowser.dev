import { describe, expect, it } from 'vitest';

import { shouldDisplay, toBadge } from './badge.js';
import { readProvenance } from './read.js';

/**
 * The badge is the only part of this package a user ever sees, so the wording
 * is the part that can mislead. These tests are mostly about what it refuses
 * to say: there is no "authentic" state, absence never reads as real, and a
 * tool name never becomes an accusation.
 */

/** Builds bytes from literal bytes and ASCII strings. */
function bytes(...parts: (number[] | string)[]): Uint8Array {
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

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function xmp(inner: string): string {
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/">${inner}</x:xmpmeta>`;
}

function sourceType(term: string): string {
  return xmp(
    `<rdf:Description Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/${term}"/>`,
  );
}

describe('what the badge says', () => {
  it('calls a declared generative file AI-generated, and shows it unprompted', () => {
    const badge = toBadge(readProvenance(bytes(JPEG, sourceType('trainedAlgorithmicMedia'))));

    expect(badge.kind).toBe('ai');
    expect(badge.label).toBe('AI-generated');
    expect(badge.prominent).toBe(true);
  });

  it('reports a camera claim as a claim, not as authenticity', () => {
    const badge = toBadge(readProvenance(bytes(JPEG, sourceType('digitalCapture'))));

    expect(badge.kind).toBe('camera');
    expect(badge.label).toBe('Camera capture');
    // Nothing here can establish a photo is genuine, so nothing says so.
    expect(badge.label).not.toMatch(/authentic|verified|genuine|real/i);
    expect(badge.detail).toMatch(/not a signature/i);
  });

  it('does not interrupt the page for an unsigned camera claim', () => {
    const unsigned = toBadge(readProvenance(bytes(JPEG, sourceType('digitalCapture'))));
    const signed = toBadge(readProvenance(bytes(PNG, 'caBX', sourceType('digitalCapture'))));

    expect(unsigned.prominent).toBe(false);
    expect(signed.prominent).toBe(true);
  });

  it('reports a manifest that declares nothing as exactly that', () => {
    const badge = toBadge(readProvenance(bytes(PNG, 'caBX', 'manifest')));

    expect(badge.kind).toBe('signed');
    expect(badge.detail).toMatch(/does not declare how it was made/i);
    expect(badge.prominent).toBe(true);
  });

  it('treats a generator name as a hint and keeps it off the page', () => {
    const badge = toBadge(readProvenance(bytes(JPEG, xmp('<xmp:CreatorTool>Midjourney</xmp:CreatorTool>'))));

    expect(badge.kind).toBe('hint');
    expect(badge.label).toBe('Possible AI tool');
    // "Opened in Firefly" must not train people to read the badge as "fake".
    expect(badge.prominent).toBe(false);
  });

  it('never turns a bare file into a claim about it', () => {
    const badge = toBadge(readProvenance(bytes(JPEG, 'ordinary pixels')));

    expect(badge.kind).toBe('unknown');
    expect(badge.prominent).toBe(false);
    expect(badge.detail).toMatch(/not evidence either way/i);
  });

  it('attaches the report caveats to every badge', () => {
    const samples = [
      bytes(JPEG, sourceType('trainedAlgorithmicMedia')),
      bytes(JPEG, sourceType('digitalCapture')),
      bytes(PNG, 'caBX'),
      bytes(JPEG, xmp('<xmp:CreatorTool>Midjourney</xmp:CreatorTool>')),
      bytes(JPEG, 'nothing'),
    ];

    for (const sample of samples) {
      const report = readProvenance(sample);
      const badge = toBadge(report);
      // The caveat is what stops the badge overclaiming, so it is never optional.
      for (const note of report.notes) expect(badge.detail).toContain(note);
    }
  });

  it('never labels anything as verified', () => {
    const samples = [
      bytes(PNG, 'caBX', sourceType('digitalCapture')),
      bytes(PNG, 'caBX'),
      bytes(JPEG, sourceType('digitalCapture')),
    ];

    for (const sample of samples) {
      expect(toBadge(readProvenance(sample)).label).not.toMatch(/verified|authentic/i);
    }
  });
});

describe('shouldDisplay', () => {
  it('draws findings that say something and holds back the rest', () => {
    const ai = toBadge(readProvenance(bytes(JPEG, sourceType('trainedAlgorithmicMedia'))));
    const nothing = toBadge(readProvenance(bytes(JPEG, 'plain')));
    const hint = toBadge(readProvenance(bytes(JPEG, xmp('<x>Midjourney</x>'))));

    expect(shouldDisplay(ai)).toBe(true);
    expect(shouldDisplay(nothing)).toBe(false);
    expect(shouldDisplay(hint)).toBe(false);
  });
});
