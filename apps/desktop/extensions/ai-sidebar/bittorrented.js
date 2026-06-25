// Connect a bittorrented.com account to TronBrowser via the hosted token-grant
// flow (chrome.identity). bittorrented.com/connect mints a bearer token and
// redirects back to the extension's chromiumapp.org callback with #token=...
// The token is stored locally (per device) and sent as `Authorization: Bearer`
// to bittorrented.com's /api/v1/* endpoints (favorites, live TV, radio, podcasts).

export const BTR_BASE = 'https://bittorrented.com';
const KEY = 'btrToken';

export async function getToken() {
  return (await chrome.storage.local.get(KEY))[KEY] || '';
}

export async function connect() {
  const redirect = chrome.identity.getRedirectURL(); // https://<ext-id>.chromiumapp.org/
  const url = `${BTR_BASE}/connect?redirect=${encodeURIComponent(redirect)}`;
  const finalUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  if (!finalUrl) throw new Error('connect cancelled');
  const token = new URLSearchParams(new URL(finalUrl).hash.slice(1)).get('token');
  if (!token) throw new Error('no token returned');
  await chrome.storage.local.set({ [KEY]: token });
  return verify();
}

export async function verify() {
  const token = await getToken();
  if (!token) return { connected: false };
  try {
    const r = await fetch(`${BTR_BASE}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return { connected: false };
    const d = await r.json();
    return { connected: true, email: d.email || null };
  } catch {
    return { connected: false };
  }
}

export async function disconnect() {
  await chrome.storage.local.remove(KEY);
}
