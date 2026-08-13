/**
 * Attaching provenance badges to media on a page.
 *
 * The only network traffic this causes is a re-request for an image the page
 * already loaded, to the origin that already served it, normally answered from
 * cache. No third party learns anything. That distinction is the whole design:
 * reading provenance is local, and asking someone else about it is a separate,
 * opt-in feature that lives in `remote.ts`.
 */

import { readProvenance, SCAN_BYTES, type ProvenanceReport } from './read.js';
import { shouldDisplay, toBadge, type Badge } from './badge.js';

/** Marks an element as handled, so a re-scan does not double-badge it. */
export const SCANNED_ATTRIBUTE = 'data-tron-provenance';

export interface ScanOptions {
  /** Root to scan. Defaults to the whole document. */
  readonly root?: ParentNode;
  /** Injectable so tests never touch the network. */
  readonly fetchImpl?: typeof fetch;
  /** Skip images smaller than this, in CSS pixels. Icons are not worth a fetch. */
  readonly minSize?: number;
  /** Cap on how many elements one pass will fetch. */
  readonly maxElements?: number;
  /** Show every badge, including the ones normally left on demand. */
  readonly showAll?: boolean;
  /** Called for each element examined. */
  readonly onResult?: (element: Element, report: ProvenanceReport, badge: Badge) => void;
}

export interface ScanResult {
  readonly examined: number;
  readonly badged: number;
  readonly skipped: number;
}

/**
 * Fetches the head of a media file.
 *
 * A `Range` request keeps this to the couple of kilobytes that actually carry
 * provenance; `same-origin` credentials avoid turning a badge into a way to
 * make authenticated cross-site requests.
 *
 * @param url - The media URL, as the page loaded it
 * @param fetchImpl - Fetch implementation
 * @returns The head of the file, or null if it could not be read
 */
export async function fetchHead(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array | null> {
  try {
    const response = await fetchImpl(url, {
      headers: { Range: `bytes=0-${SCAN_BYTES - 1}` },
      credentials: 'same-origin',
      // Prefer the copy the page already has; a badge must not double the
      // bandwidth cost of viewing a page.
      cache: 'force-cache',
    });

    if (!response.ok && response.status !== 206) return null;

    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    return bytes.length > SCAN_BYTES ? bytes.subarray(0, SCAN_BYTES) : bytes;
  } catch {
    // A CORS refusal or a network fault is not worth surfacing: the honest
    // result is "we could not read it", which is what a missing badge means.
    return null;
  }
}

/**
 * Reads provenance for one element and returns its badge.
 *
 * @param element - An img or video element
 * @param fetchImpl - Fetch implementation
 * @returns The report and badge, or null when the bytes were unreadable
 */
export async function inspect(
  element: Element,
  fetchImpl: typeof fetch = fetch,
): Promise<{ report: ProvenanceReport; badge: Badge } | null> {
  const url = mediaUrl(element);
  if (url === null) return null;

  const bytes = await fetchHead(url, fetchImpl);
  if (bytes === null || bytes.length === 0) return null;

  const report = readProvenance(bytes);
  return { report, badge: toBadge(report) };
}

/**
 * Reads the source URL off a media element.
 *
 * `data:` URLs are skipped: re-fetching one is pointless, and they are usually
 * the tiny placeholders a lazy-loading page uses.
 *
 * @param element - An img or video element
 * @returns The URL, or null when there is nothing worth fetching
 */
export function mediaUrl(element: Element): string | null {
  const raw =
    element.getAttribute('src') ??
    element.getAttribute('data-src') ??
    element.querySelector('source')?.getAttribute('src') ??
    null;

  if (raw === null || raw === '') return null;
  if (raw.startsWith('data:')) return null;
  return raw;
}

/**
 * Scans a page and attaches badges.
 *
 * Bounded on purpose: an image gallery with three hundred thumbnails should
 * not produce three hundred range requests because a badge feature is on.
 *
 * @param options - Scan behaviour
 * @returns What the pass did
 */
export async function scanMedia(options: ScanOptions = {}): Promise<ScanResult> {
  const root = options.root ?? document;
  const minSize = options.minSize ?? 96;
  const maxElements = options.maxElements ?? 40;
  const fetchImpl = options.fetchImpl ?? fetch;

  const candidates = [...root.querySelectorAll('img, video')]
    .filter((element) => !element.hasAttribute(SCANNED_ATTRIBUTE))
    .filter((element) => isBigEnough(element, minSize));

  let badged = 0;
  let skipped = 0;
  const examined = Math.min(candidates.length, maxElements);

  for (const element of candidates.slice(0, maxElements)) {
    // Marked before the await, so a concurrent pass cannot pick it up too.
    element.setAttribute(SCANNED_ATTRIBUTE, 'pending');

    const result = await inspect(element, fetchImpl);
    if (result === null) {
      element.setAttribute(SCANNED_ATTRIBUTE, 'unreadable');
      skipped += 1;
      continue;
    }

    element.setAttribute(SCANNED_ATTRIBUTE, result.badge.kind);
    options.onResult?.(element, result.report, result.badge);

    if (options.showAll === true || shouldDisplay(result.badge)) {
      attachBadge(element, result.badge);
      badged += 1;
    }
  }

  return { examined, badged, skipped };
}

/**
 * Whether an element is large enough to be worth a request.
 *
 * @param element - The element
 * @param minSize - Minimum edge length in pixels
 * @returns True when it is big enough
 */
function isBigEnough(element: Element, minSize: number): boolean {
  const width = Number(element.getAttribute('width') ?? 0);
  const height = Number(element.getAttribute('height') ?? 0);

  // An element with no declared size has not necessarily rendered yet, so it
  // gets the benefit of the doubt rather than being silently dropped.
  if (width === 0 && height === 0) return true;
  return width >= minSize || height >= minSize;
}

/**
 * Draws a badge next to an element.
 *
 * The badge is a sibling in a wrapper rather than a child, because `img` and
 * `video` cannot contain elements — appending to them silently does nothing.
 *
 * @param element - The element to badge
 * @param badge - What to say
 * @returns The badge element
 */
export function attachBadge(element: Element, badge: Badge): Element {
  const document_ = element.ownerDocument;
  const marker = document_.createElement('span');

  marker.className = `tron-provenance tron-provenance--${badge.kind}`;
  marker.setAttribute('role', 'note');
  marker.setAttribute('title', badge.detail);
  // The detail is the part that stops the badge overclaiming, so it has to
  // reach a screen reader rather than living in a hover-only tooltip.
  marker.setAttribute('aria-label', `${badge.label}. ${badge.detail}`);
  marker.setAttribute('tabindex', '0');
  marker.textContent = badge.label;

  element.parentNode?.insertBefore(marker, element.nextSibling);
  return marker;
}
