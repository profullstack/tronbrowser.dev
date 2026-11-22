/**
 * The User-Agent every server-side call to CoinPay sends, so CoinPay's logs and
 * throttle can tell this app apart from the other fleet apps on the same box.
 */
import { createRequire } from 'node:module';

function version(): string | undefined {
  if (process.env.npm_package_version) return process.env.npm_package_version;
  try {
    // src/ and dist/ both sit one level below services/api.
    return (createRequire(import.meta.url)('../package.json') as { version?: string }).version;
  } catch {
    return undefined;
  }
}

const v = version();
export const COINPAY_UA = `tronbrowser.dev${v ? `/${v}` : ''} (+https://tronbrowser.dev)`;

/** fetch that adds COINPAY_UA unless the caller already set a User-Agent. Plain-object headers stay plain objects. */
export const coinpayFetch: typeof fetch = (input, init = {}) => {
  const h = init.headers;
  if (h instanceof Headers || Array.isArray(h)) {
    const headers = new Headers(h);
    if (!headers.has('user-agent')) headers.set('user-agent', COINPAY_UA);
    return fetch(input, { ...init, headers });
  }
  const plain = (h ?? {}) as Record<string, string>;
  if (Object.keys(plain).some((k) => k.toLowerCase() === 'user-agent')) return fetch(input, init);
  return fetch(input, { ...init, headers: { ...plain, 'user-agent': COINPAY_UA } });
};
