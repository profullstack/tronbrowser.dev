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

/** fetch that adds COINPAY_UA unless the caller already set a User-Agent. */
export const coinpayFetch: typeof fetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('user-agent')) headers.set('user-agent', COINPAY_UA);
  return fetch(input, { ...init, headers });
};
