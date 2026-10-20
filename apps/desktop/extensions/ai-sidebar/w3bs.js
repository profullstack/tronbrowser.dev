// W3BS URIs (w3bs://type/namespace/name@version) open through the w3bs.org
// resolver page: Chromium has no handler for the scheme. The launcher and the
// w3bs-links.js content script use the same gateway. w3bs://chovy.hacker names
// a site rather than a resource, and the resolver opens it at its pit.world
// gateway; with Pit on, Moshpit names resolve in this browser, so it opens as
// itself (PIT_DIRECT_RULES).
export const W3BS_GATEWAY = 'https://w3bs.org/browse?q=';

/** The resolver URL for a w3bs: URI, or null when `input` is not one. */
export function w3bsUrl(input) {
  const uri = String(input ?? '').trim();
  return /^w3bs:/i.test(uri) ? W3BS_GATEWAY + encodeURIComponent(uri) : null;
}

/** https://chovy.hacker/path for w3bs://chovy.hacker/path (a dotted authority is a site); else null. */
export function w3bsSiteUrl(input) {
  const m = /^w3bs:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(\/\S*)?$/i.exec(String(input ?? '').trim());
  return m ? `https://${m[1].toLowerCase()}${m[2] || '/'}` : null;
}

/** Where a w3bs: URI opens: the site itself when Pit is on and it names one, else the resolver. */
export function w3bsTarget(input, { pit = false } = {}) {
  return (pit && w3bsSiteUrl(input)) || w3bsUrl(input);
}

/**
 * Where to send a tab that landed on a search results page whose query is a
 * W3BS URI (or, with Pit on, on the resolver page for a site), or null.
 * Chromium searches a typed w3bs://chovy.hacker instead of opening it, and when
 * the omnibox serves that search from its prefetch the declarativeNetRequest
 * rules never see a request, so the background worker also checks every URL a
 * tab lands on.
 */
export function w3bsFromSearch(href, { pit = false } = {}) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const q = url.searchParams.get('q');
  if (!q) return null;
  if (url.hostname === 'w3bs.org') return pit && url.pathname === '/browse' ? w3bsSiteUrl(q) : null;
  return w3bsTarget(q, { pit });
}

// Session rules while Pit is on: a search for w3bs://<name>, or the hop to
// w3bs.org/browse it redirects to, goes straight to https://<name>/. Higher
// priority than w3bs-rules.json, which sends every w3bs:// search to w3bs.org.
// A path is left to the resolver: the rule cannot percent-decode it.
export const PIT_DIRECT_RULES = [
  {
    id: 101,
    priority: 2,
    action: { type: 'redirect', redirect: { regexSubstitution: 'https://\\1/' } },
    condition: {
      regexFilter:
        '^https://[^/]+/[^?#]*\\?(?:[^#]*&)?q=w3bs(?:%3A|:)(?:%2F|/){2}([a-z0-9-]+(?:\\.[a-z0-9-]+)+)(?:%2F|/)?(?:[&#].*)?$',
      isUrlFilterCaseSensitive: false,
      resourceTypes: ['main_frame'],
    },
  },
];
