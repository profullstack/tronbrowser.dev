/**
 * Pure helper for the in-browser Tor toggle. The existing AI-sidebar extension
 * flips the LIVE session through Tor via `chrome.proxy` (no relaunch, no second
 * instance). Kept here, unit tested, and mirrored by
 * `extensions/ai-sidebar/tor-proxy.js` — the same pattern as `providers.js`
 * mirroring the model-provider adapters.
 *
 * The extension re-routes traffic but cannot start the `tor` daemon itself, so
 * the toggle expects Tor running on the SOCKS port (start it easily with
 * `tron tor`). See `docs/tor-onion-mode.md`.
 */

import { DEFAULT_TOR_SOCKS_PORT } from './chromium-flags.js';

/** Endpoint used to confirm traffic is actually exiting via Tor. */
export const TOR_CHECK_URL = 'https://check.torproject.org/api/ip' as const;

export interface TorProxyConfig {
  mode: 'fixed_servers';
  rules: {
    singleProxy: { scheme: 'socks5'; host: '127.0.0.1'; port: number };
    bypassList: string[];
  };
}

/**
 * Loopback must bypass the proxy: Tor's SOCKS port itself is on 127.0.0.1, and
 * Tor refuses to proxy connections to private/loopback addresses anyway — so
 * routing localhost through Tor would just break the local control channel.
 */
export const TOR_BYPASS_LIST = ['localhost', '127.0.0.1', '[::1]'] as const;

/**
 * `chrome.proxy` `fixed_servers` config that routes all *non-loopback* traffic
 * through the local Tor SOCKS5 proxy. SOCKS5 (not SOCKS4) means Chromium
 * resolves DNS at the proxy — names, including `.onion`, are resolved inside Tor
 * with no local leak.
 */
export function buildTorProxyConfig(socksPort: number = DEFAULT_TOR_SOCKS_PORT): TorProxyConfig {
  return {
    mode: 'fixed_servers',
    rules: {
      singleProxy: { scheme: 'socks5', host: '127.0.0.1', port: socksPort },
      bypassList: [...TOR_BYPASS_LIST],
    },
  };
}
