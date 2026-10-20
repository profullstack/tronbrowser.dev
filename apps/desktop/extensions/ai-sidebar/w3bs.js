// W3BS URIs (w3bs://type/namespace/name@version) open through the w3bs.org
// resolver page: Chromium has no handler for the scheme. The launcher and the
// w3bs-links.js content script use the same gateway.
export const W3BS_GATEWAY = 'https://w3bs.org/browse?q=';

/** The resolver URL for a w3bs: URI, or null when `input` is not one. */
export function w3bsUrl(input) {
  const uri = String(input ?? '').trim();
  return /^w3bs:/i.test(uri) ? W3BS_GATEWAY + encodeURIComponent(uri) : null;
}

/**
 * The resolver URL for a search results page whose query is a W3BS URI, or
 * null. Chromium searches a typed w3bs://chovy.hacker instead of opening it,
 * and when the omnibox serves that search from its prefetch the
 * declarativeNetRequest rule in w3bs-rules.json never sees a request, so the
 * background worker also checks every URL a tab lands on.
 */
export function w3bsFromSearch(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname === 'w3bs.org') return null;
  const q = url.searchParams.get('q');
  return q ? w3bsUrl(q) : null;
}
