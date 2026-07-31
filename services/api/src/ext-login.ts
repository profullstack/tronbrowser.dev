import { safeRedirect } from './redirect.js';

/**
 * Where /api/auth/ext-login should send the browser.
 *
 * The extension can't complete a chrome.identity flow: getRedirectURL() hands
 * back an off-origin https://<ext-id>.chromiumapp.org/ URL, which safeRedirect()
 * rejects (rightly — the session token rides in the redirect fragment). The
 * result was a silent half-login: the OAuth dance finished, the WEBSITE got its
 * tb_session cookie, and the extension got nothing.
 *
 * So the extension now asks for an on-origin /ext-callback.html target, where
 * its content script reads the token out of the fragment.
 *
 * - `reject`  — redirect target missing or off-origin; refuse.
 * - `session` — already signed in on the website: mint a session for the
 *               extension and hand it straight back, no second CoinPay trip.
 * - `oauth`   — not signed in: run the CoinPay dance, preserving the target.
 */
export type ExtLoginTarget =
  | { kind: 'reject' }
  | { kind: 'session'; redirect: string }
  | { kind: 'oauth'; url: string };

export function extLoginTarget(
  rawRedirect: string | undefined | null,
  appUrl: string,
  signedIn: boolean,
): ExtLoginTarget {
  const redirect = safeRedirect(rawRedirect, appUrl);
  if (!redirect) return { kind: 'reject' };
  if (signedIn) return { kind: 'session', redirect };
  return {
    kind: 'oauth',
    url: `/api/auth/coinpay/login?redirect=${encodeURIComponent(redirect)}`,
  };
}
