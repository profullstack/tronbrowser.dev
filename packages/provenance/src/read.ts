/**
 * Reading what a file declares about how it was made.
 *
 * This runs entirely on bytes the browser already has. Nothing here contacts a
 * network, and that is the point: a badge that phoned an image URL home for
 * every picture on every page would be telemetry, and telemetry is exactly
 * what this browser does not do.
 *
 * Two honesty rules shape the output:
 *
 *   1. Absence proves nothing. Almost every platform strips metadata on
 *      upload, so a bare file is the common case for real photographs and AI
 *      output alike. "No manifest" is never reported as "probably real".
 *   2. Self-declaration is not proof. Only C2PA carries a signature, and even
 *      then this reports its *presence* — validating the certificate chain
 *      needs a trust list, which is a separate job.
 *
 * No Node built-ins: this has to run in a content script.
 */

/** How much of a file to inspect. Manifests and XMP live near the front. */
export const SCAN_BYTES = 2 * 1024 * 1024;

export type ProvenanceSignal =
  | 'c2pa_manifest'
  | 'iptc_digital_source_type'
  | 'generator_metadata'
  | 'none';

/**
 * How much weight a finding carries.
 *
 * `signed` — a C2PA manifest is present (validity unverified).
 * `declared` — an unsigned, editable metadata claim.
 * `hint` — a generator name, which may be a tool that merely opened the file.
 * `none` — nothing found, which is not evidence either way.
 */
export type ProvenanceStrength = 'signed' | 'declared' | 'hint' | 'none';

/** IPTC digital source types — https://cv.iptc.org/newscodes/digitalsourcetype/ */
export const DIGITAL_SOURCE_TYPES: Readonly<
  Record<string, { aiGenerated: boolean; label: string }>
> = {
  trainedAlgorithmicMedia: { aiGenerated: true, label: 'Created by a generative model' },
  compositeWithTrainedAlgorithmicMedia: {
    aiGenerated: true,
    label: 'Composite including generative model output',
  },
  algorithmicMedia: { aiGenerated: true, label: 'Created by an algorithm, not a model' },
  digitalCapture: { aiGenerated: false, label: 'Captured by a camera' },
  negativeFilm: { aiGenerated: false, label: 'Digitised from negative film' },
  positiveFilm: { aiGenerated: false, label: 'Digitised from positive film' },
  print: { aiGenerated: false, label: 'Digitised from a print' },
  digitalArt: { aiGenerated: false, label: 'Created digitally by a human' },
  composite: { aiGenerated: false, label: 'Human-made composite' },
  algorithmicallyEnhanced: { aiGenerated: false, label: 'Algorithmically enhanced capture' },
};

const GENERATOR_PATTERNS: readonly { pattern: RegExp; name: string }[] = [
  { pattern: /\bmidjourney\b/i, name: 'Midjourney' },
  { pattern: /\bdall[·.\-\s]?e\b/i, name: 'DALL·E' },
  { pattern: /\bstable\s?diffusion\b/i, name: 'Stable Diffusion' },
  { pattern: /\bcomfyui\b/i, name: 'ComfyUI' },
  { pattern: /\bfirefly\b/i, name: 'Adobe Firefly' },
  { pattern: /\bgemini\b/i, name: 'Google Gemini' },
  { pattern: /\bimagen\b/i, name: 'Google Imagen' },
  { pattern: /\bveo\b/i, name: 'Google Veo' },
  { pattern: /\bflux\b/i, name: 'FLUX' },
  { pattern: /\bopenai\b/i, name: 'OpenAI' },
  { pattern: /\bgpt-image\b/i, name: 'OpenAI gpt-image' },
];

export type MediaContainer = 'jpeg' | 'png' | 'webp' | 'isobmff' | 'unknown';

export interface C2paFinding {
  readonly present: boolean;
  readonly container?: MediaContainer;
  /** Always false. Presence is readable from bytes; validity is not. */
  readonly signatureVerified: false;
}

export interface ProvenanceReport {
  readonly signals: readonly ProvenanceSignal[];
  readonly c2pa: C2paFinding;
  readonly digitalSourceType?: string;
  readonly digitalSourceTypeLabel?: string;
  readonly generators: readonly string[];
  /** What the file declares: true (AI), false (capture), null (nothing). */
  readonly declaredAiGenerated: boolean | null;
  readonly strength: ProvenanceStrength;
  readonly notes: readonly string[];
  /** SynthID is not verifiable from bytes; this records that rather than staying silent. */
  readonly synthid: { readonly checked: false; readonly reason: string };
}

const SYNTHID_REASON =
  "SynthID watermarks are verified by Google's own detection service, not from the file's " +
  'bytes. This does not rule a SynthID watermark in or out.';

const ABSENCE_NOTE =
  'No provenance metadata was found. Most sites strip metadata on upload, so this is equally ' +
  'common for real photographs and for AI output — it is not evidence either way.';

const UNSIGNED_NOTE =
  'This claim comes from editable metadata, not a signature. It is what the file says about ' +
  'itself, not proof.';

const SIGNED_NOTE =
  'A C2PA manifest is present. This confirms its presence only — validating the signature and ' +
  'its certificate chain is a separate step.';

const HINT_NOTE =
  "A generator name appears in the file's metadata. That can mean the tool produced the image, " +
  'or merely that it was opened in it.';

/**
 * Reads every provenance signal a file carries.
 *
 * @param bytes - The head of the file; `SCAN_BYTES` is plenty
 * @returns What the file declares, and how much that is worth
 */
export function readProvenance(bytes: Uint8Array): ProvenanceReport {
  const c2pa = detectC2pa(bytes);
  const xmp = extractXmp(bytes);

  const digitalSourceType = xmp === undefined ? undefined : readDigitalSourceType(xmp);
  const known = digitalSourceType === undefined ? undefined : DIGITAL_SOURCE_TYPES[digitalSourceType];
  const generators = readGenerators(xmp ?? '');

  const signals: ProvenanceSignal[] = [];
  if (c2pa.present) signals.push('c2pa_manifest');
  if (digitalSourceType !== undefined) signals.push('iptc_digital_source_type');
  if (generators.length > 0) signals.push('generator_metadata');
  if (signals.length === 0) signals.push('none');

  let strength: ProvenanceStrength;
  const notes: string[] = [];

  if (c2pa.present) {
    strength = 'signed';
    notes.push(SIGNED_NOTE);
  } else if (digitalSourceType !== undefined) {
    strength = 'declared';
    notes.push(UNSIGNED_NOTE);
  } else if (generators.length > 0) {
    strength = 'hint';
    notes.push(HINT_NOTE);
  } else {
    strength = 'none';
    notes.push(ABSENCE_NOTE);
  }

  return {
    signals,
    c2pa,
    ...(digitalSourceType === undefined ? {} : { digitalSourceType }),
    ...(known === undefined ? {} : { digitalSourceTypeLabel: known.label }),
    generators,
    // Only a declared source type states intent. A generator name is too weak:
    // editors write their own name into the same fields.
    declaredAiGenerated: known === undefined ? null : known.aiGenerated,
    strength,
    notes,
    synthid: { checked: false, reason: SYNTHID_REASON },
  };
}

/**
 * Looks for a C2PA manifest store.
 *
 * Manifests are JUMBF boxes, carried in a JPEG APP11 segment, a PNG `caBX`
 * chunk, a WebP `C2PA` chunk or a top-level ISO-BMFF box. Scanning for the
 * labels keeps this format-agnostic.
 *
 * @param bytes - File head
 * @returns Whether a manifest is present, and the container it came from
 */
export function detectC2pa(bytes: Uint8Array): C2paFinding {
  const hasJumbf = indexOfAscii(bytes, 'jumb') !== -1 || indexOfAscii(bytes, 'jumd') !== -1;
  const hasC2paLabel = indexOfAscii(bytes, 'c2pa') !== -1;
  const hasNamedChunk = indexOfAscii(bytes, 'caBX') !== -1 || indexOfAscii(bytes, 'C2PA') !== -1;

  // A caption merely mentioning "c2pa" must not register as a manifest, so the
  // bare label only counts alongside a JUMBF marker.
  const present = hasNamedChunk || (hasC2paLabel && hasJumbf);

  return present
    ? { present: true, container: detectContainer(bytes), signatureVerified: false }
    : { present: false, signatureVerified: false };
}

/**
 * Identifies the container from its magic bytes.
 *
 * @param bytes - File head
 * @returns The container, or 'unknown'
 */
export function detectContainer(bytes: Uint8Array): MediaContainer {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (indexOfAscii(bytes.subarray(0, 16), 'WEBP') !== -1) return 'webp';
  if (indexOfAscii(bytes.subarray(0, 32), 'ftyp') !== -1) return 'isobmff';
  return 'unknown';
}

/**
 * Pulls the XMP packet out of a file.
 *
 * @param bytes - File head
 * @returns The XMP document, or undefined
 */
export function extractXmp(bytes: Uint8Array): string | undefined {
  const start = indexOfAscii(bytes, '<x:xmpmeta');
  if (start === -1) return undefined;

  const marker = '</x:xmpmeta>';
  const end = indexOfAscii(bytes, marker, start);
  if (end === -1) return undefined;

  return asciiSlice(bytes, start, end + marker.length);
}

/**
 * Reads the IPTC `DigitalSourceType` term from an XMP document.
 *
 * @param xmp - XMP document
 * @returns The bare term, or undefined
 */
export function readDigitalSourceType(xmp: string): string | undefined {
  const attribute = /DigitalSourceType\s*=\s*"([^"]+)"/i.exec(xmp);
  const element = /<[^>]*DigitalSourceType[^>]*>([^<]+)</i.exec(xmp);

  const raw = (attribute?.[1] ?? element?.[1] ?? '').trim();
  if (raw === '') return undefined;

  const term = raw.split('/').pop()?.trim();
  return term === undefined || term === '' ? undefined : term;
}

/**
 * Finds known generator names in a metadata blob.
 *
 * @param metadata - XMP or other extracted text
 * @returns Matching names, de-duplicated
 */
export function readGenerators(metadata: string): string[] {
  if (metadata === '') return [];

  const found = new Set<string>();
  for (const { pattern, name } of GENERATOR_PATTERNS) {
    if (pattern.test(metadata)) found.add(name);
  }
  return [...found];
}

/**
 * Finds an ASCII needle in a byte array.
 *
 * Hand-written rather than decoding the buffer to a string first: these are
 * megabytes of binary, and decoding to run `indexOf` allocates a copy for
 * nothing — on a page with fifty images that cost is real.
 *
 * @param haystack - Bytes to search
 * @param needle - ASCII string to find
 * @param from - Index to start at
 * @returns Byte offset, or -1
 */
export function indexOfAscii(haystack: Uint8Array, needle: string, from = 0): number {
  if (needle.length === 0 || haystack.length < needle.length) return -1;

  const target = new Uint8Array(needle.length);
  for (let i = 0; i < needle.length; i += 1) target[i] = needle.charCodeAt(i);

  const last = haystack.length - target.length;
  outer: for (let i = Math.max(0, from); i <= last; i += 1) {
    for (let j = 0; j < target.length; j += 1) {
      if (haystack[i + j] !== target[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Decodes a byte range as Latin-1 text.
 *
 * @param bytes - Source bytes
 * @param start - Start offset
 * @param end - End offset, exclusive
 * @returns The decoded string
 */
function asciiSlice(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end && i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i] ?? 0);
  }
  return out;
}
