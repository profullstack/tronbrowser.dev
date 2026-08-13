import { describe, expect, it } from 'vitest';

import {
  DIGITAL_SOURCE_TYPES,
  detectC2pa,
  detectContainer,
  extractXmp,
  indexOfAscii,
  readDigitalSourceType,
  readGenerators,
  readProvenance,
} from './read.js';

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

const xmp = (inner: string): string => `<x:xmpmeta xmlns:x="adobe:ns:meta/">${inner}</x:xmpmeta>`;

describe('indexOfAscii', () => {
  it('finds a needle, honours an offset, and handles the edges', () => {
    expect(indexOfAscii(bytes('hello world'), 'world')).toBe(6);
    expect(indexOfAscii(bytes('abcabc'), 'abc', 1)).toBe(3);
    expect(indexOfAscii(bytes('hello'), 'zebra')).toBe(-1);
    expect(indexOfAscii(bytes('ab'), 'abcdef')).toBe(-1);
    expect(indexOfAscii(bytes('ab'), '')).toBe(-1);
  });
});

describe('detectContainer', () => {
  it('recognises the containers that can carry a manifest', () => {
    expect(detectContainer(bytes(JPEG))).toBe('jpeg');
    expect(detectContainer(bytes(PNG))).toBe('png');
    expect(detectContainer(bytes('RIFF____WEBPVP8 '))).toBe('webp');
    expect(detectContainer(bytes([0, 0, 0, 24], 'ftypmp42'))).toBe('isobmff');
    expect(detectContainer(bytes('text'))).toBe('unknown');
    expect(detectContainer(new Uint8Array(0))).toBe('unknown');
  });
});

describe('detectC2pa', () => {
  it('detects a PNG caBX chunk and a JUMBF box', () => {
    expect(detectC2pa(bytes(PNG, 'caBX', 'store')).present).toBe(true);
    expect(detectC2pa(bytes(JPEG, '__jumb', 'jumdc2pa')).present).toBe(true);
  });

  it('does not fire on a caption that merely mentions c2pa', () => {
    expect(detectC2pa(bytes(JPEG, 'photo tagged c2pa by the author')).present).toBe(false);
  });

  it('never claims the signature was checked', () => {
    expect(detectC2pa(bytes(PNG, 'caBX')).signatureVerified).toBe(false);
    expect(detectC2pa(bytes(JPEG, 'plain')).signatureVerified).toBe(false);
  });
});

describe('extractXmp', () => {
  it('pulls a packet out of surrounding binary', () => {
    const packet = xmp('<rdf:RDF/>');
    expect(extractXmp(bytes(JPEG, [1, 2, 3], packet, [9]))).toBe(packet);
  });

  it('returns undefined when absent or unterminated', () => {
    expect(extractXmp(bytes(JPEG, 'nothing'))).toBeUndefined();
    expect(extractXmp(bytes('<x:xmpmeta truncated'))).toBeUndefined();
  });
});

describe('readDigitalSourceType', () => {
  it('reads the attribute and element forms, keeping only the term', () => {
    expect(
      readDigitalSourceType(
        xmp('<rdf:Description Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/>'),
      ),
    ).toBe('trainedAlgorithmicMedia');

    expect(
      readDigitalSourceType(
        xmp('<Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture</Iptc4xmpExt:DigitalSourceType>'),
      ),
    ).toBe('digitalCapture');
  });

  it('returns undefined when missing or empty', () => {
    expect(readDigitalSourceType(xmp('<rdf:RDF/>'))).toBeUndefined();
    expect(readDigitalSourceType('DigitalSourceType=""')).toBeUndefined();
  });
});

describe('readGenerators', () => {
  it('finds and de-duplicates known names', () => {
    expect(readGenerators('CreatorTool: Midjourney v6')).toEqual(['Midjourney']);
    expect(readGenerators('midjourney and Midjourney')).toEqual(['Midjourney']);
    expect(readGenerators('Software=DALL·E 3')).toEqual(['DALL·E']);
  });

  it('stays quiet on ordinary camera metadata', () => {
    expect(readGenerators('Canon EOS R5')).toEqual([]);
    expect(readGenerators('')).toEqual([]);
  });
});

describe('readProvenance', () => {
  it('ranks a manifest above a declaration above a hint', () => {
    expect(readProvenance(bytes(PNG, 'caBX')).strength).toBe('signed');
    expect(
      readProvenance(
        bytes(JPEG, xmp('<rdf:Description Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/>')),
      ).strength,
    ).toBe('declared');
    expect(readProvenance(bytes(JPEG, xmp('<x>Midjourney</x>'))).strength).toBe('hint');
    expect(readProvenance(bytes(JPEG, 'plain')).strength).toBe('none');
  });

  it('never reads absence as evidence', () => {
    const report = readProvenance(bytes(JPEG, 'plain'));

    expect(report.signals).toEqual(['none']);
    expect(report.declaredAiGenerated).toBeNull();
    expect(report.notes.join(' ')).toMatch(/not evidence either way/i);
  });

  it('does not let a generator name declare the file AI-generated', () => {
    expect(readProvenance(bytes(JPEG, xmp('<x>Midjourney</x>'))).declaredAiGenerated).toBeNull();
  });

  it('always records that SynthID was not checked', () => {
    for (const sample of [bytes(JPEG), bytes(PNG, 'caBX')]) {
      expect(readProvenance(sample).synthid.checked).toBe(false);
      expect(readProvenance(sample).synthid.reason).toMatch(/SynthID/);
    }
  });

  it('collects every signal at once', () => {
    const report = readProvenance(
      bytes(
        PNG,
        'caBX',
        xmp('<rdf:Description Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" xmp:CreatorTool="Adobe Firefly"/>'),
      ),
    );

    expect(report.signals).toEqual([
      'c2pa_manifest',
      'iptc_digital_source_type',
      'generator_metadata',
    ]);
    expect(report.generators).toEqual(['Adobe Firefly']);
  });

  it('handles an empty file', () => {
    expect(readProvenance(new Uint8Array(0)).strength).toBe('none');
  });
});

describe('DIGITAL_SOURCE_TYPES', () => {
  it('marks only the generative terms as AI', () => {
    const ai = Object.entries(DIGITAL_SOURCE_TYPES)
      .filter(([, value]) => value.aiGenerated)
      .map(([key]) => key)
      .sort();

    expect(ai).toEqual([
      'algorithmicMedia',
      'compositeWithTrainedAlgorithmicMedia',
      'trainedAlgorithmicMedia',
    ]);
  });

  it('does not treat an enhanced capture as AI-generated', () => {
    expect(DIGITAL_SOURCE_TYPES.algorithmicallyEnhanced?.aiGenerated).toBe(false);
  });
});
