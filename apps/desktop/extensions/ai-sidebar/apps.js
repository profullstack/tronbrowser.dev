// New-tab "Apps" widget: Profullstack's apps on pwamart.com, one tap to install.
//
// Installing goes through `tron pwa` over native messaging (host
// dev.tronbrowser.pwa, registered by the launcher inside the profile). It puts
// the app in the system app drawer as a standalone TronBrowser window, which is
// the only real install the engine allows us without root. Where the host is
// not there (macOS, Windows, a Tor profile) the button opens the app in its own
// window instead, and says so.

import { fetchWithTimeout } from './net.js';

export const PWAMART = 'https://pwamart.com';
export const PUBLISHER = 'profullstack';
export const HOST = 'dev.tronbrowser.pwa';
// Pinned first, and installed for every new profile by the launcher.
export const DEFAULT_APPS = ['coinpay', 'logicsrc', 'tronbrowser'];
const TTL = 6 * 60 * 60 * 1000;

export function host(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(HOST, msg, (reply) => {
        const err = chrome.runtime.lastError;
        resolve(err ? { ok: false, error: err.message, noHost: true } : reply || { ok: false, error: 'no reply' });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e), noHost: true });
    }
  });
}

// Defaults first (in their order), then the rest by pwamart's own order.
export function orderApps(apps) {
  const rank = (a) => {
    const i = DEFAULT_APPS.indexOf(a.slug);
    return i === -1 ? DEFAULT_APPS.length : i;
  };
  return apps
    .filter((a) => a && /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/.test(a.slug) && /^https:\/\//.test(a.start_url || a.url || ''))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
    .map(({ a }) => a);
}

export async function loadApps() {
  const { pwamartApps } = await chrome.storage.local.get('pwamartApps');
  if (pwamartApps && Date.now() - pwamartApps.at < TTL) return pwamartApps.apps;
  try {
    const res = await fetchWithTimeout(`${PWAMART}/api/v1/publishers/${PUBLISHER}`, {}, 10000);
    // A 402 (pwamart's bot gate answers headless browsers with x402) or any
    // other failure must not be cached as "no apps" for the next six hours.
    if (!res.ok) throw new Error(`pwamart ${res.status}`);
    const data = await res.json();
    const apps = orderApps(data.apps || []).map((a) => ({
      slug: a.slug, name: a.name, summary: a.summary || '', icon: a.icon || '', start_url: a.start_url || a.url,
    }));
    if (apps.length) await chrome.storage.local.set({ pwamartApps: { at: Date.now(), apps } });
    return apps;
  } catch {
    return pwamartApps ? pwamartApps.apps : [];
  }
}
