// W3BS URIs (w3bs://type/namespace/name@version) open through the w3bs.org
// resolver page: Chromium has no handler for the scheme. The launcher and the
// w3bs-links.js content script use the same gateway.
export const W3BS_GATEWAY = 'https://w3bs.org/browse?q=';

/** The resolver URL for a w3bs: URI, or null when `input` is not one. */
export function w3bsUrl(input) {
  const uri = String(input ?? '').trim();
  return /^w3bs:/i.test(uri) ? W3BS_GATEWAY + encodeURIComponent(uri) : null;
}
