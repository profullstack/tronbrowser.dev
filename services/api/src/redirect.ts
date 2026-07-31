/**
 * Validate a post-login redirect target.
 *
 * The OAuth/login flow appends the freshly minted session token to the
 * redirect URL's fragment (`${redirect}#token=...`), so an unvalidated
 * redirect (`?redirect=https://evil.com`) lets an attacker exfiltrate the
 * victim's session token. Only honor targets that stay on our own origin —
 * an absolute same-origin URL or a site-relative path; everything else
 * (external hosts, protocol-relative `//evil.com`, `javascript:` URLs,
 * unparseable input) is rejected so the caller falls back to a safe default.
 */
export function safeRedirect(
  redirect: string | undefined | null,
  appUrl: string,
): string | undefined {
  if (!redirect) return undefined;
  try {
    const target = new URL(redirect, appUrl);
    if (target.origin === new URL(appUrl).origin) return target.toString();
  } catch {
    /* not a parseable URL — reject */
  }
  return undefined;
}
