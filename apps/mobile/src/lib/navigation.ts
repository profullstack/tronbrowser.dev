export const HOME = 'https://tronbrowser.dev';

const DOMAIN_OR_IP =
  /^(?:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}|(?:\d{1,3}\.){3}\d{1,3}|localhost)(?::\d{1,5})?(?:[/?#][^\s]*)?$/i;

function searchUrl(query: string): string {
  // DuckDuckGo answers without an account. Kagi is subscription-only past its
  // trial, so defaulting to it left a fresh install with a broken search box —
  // the same out-of-box failure the desktop launcher already corrects.
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

/**
 * Convert address-bar input into a safe, loadable URL.
 *
 * Only explicit HTTP(S) URLs and complete domain/IP inputs are navigated to.
 * Everything else, including unsupported schemes and domain-looking text with
 * spaces, becomes a search query instead of reaching the WebView as a URL.
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return HOME;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
        ? parsed.toString()
        : searchUrl(trimmed);
    } catch {
      return searchUrl(trimmed);
    }
  }

  if (DOMAIN_OR_IP.test(trimmed)) {
    try {
      return new URL(`https://${trimmed}`).toString();
    } catch {
      return searchUrl(trimmed);
    }
  }

  return searchUrl(trimmed);
}

/**
 * Validate a URL that page content asked us to open (`window.open`,
 * `target="_blank"`). Unlike address-bar input there is no search fallback:
 * only an absolute HTTP(S) URL may navigate the tab, and anything else
 * (javascript:, data:, intent:, about:, malformed) is dropped entirely.
 */
export function navigableHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}
