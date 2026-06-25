// Connect a bittorrented.com account to TronBrowser via the hosted token-grant
// flow (chrome.identity). bittorrented.com/connect mints a bearer token and
// redirects back to the extension's chromiumapp.org callback with #token=...
// The token is stored locally (per device) and sent as `Authorization: Bearer`
// to bittorrented.com's /api/v1/* endpoints (favorites, live TV, radio, podcasts).

export const BTR_BASE = 'https://bittorrented.com';
const TB_WEB = 'https://tronbrowser.dev';
const KEY = 'btrToken';

export async function getToken() {
  return (await chrome.storage.local.get(KEY))[KEY] || '';
}

// Open the connect flow in a normal tab and wait for the token. We do NOT use
// chrome.identity.launchWebAuthFlow: its chromiumapp.org callback is rewritten
// to a non-resolving .qjz9zk host by Ungoogled Chromium's domain substitution,
// so the redirect can't be intercepted ("Authorization page could not be
// loaded"). Instead bittorrented.com redirects to tronbrowser.dev/ext-callback,
// where our content script captures the token and the background stores it.
export async function connect() {
  const redirect = `${TB_WEB}/ext-callback.html`;
  const url = `${BTR_BASE}/connect?redirect=${encodeURIComponent(redirect)}`;
  await chrome.storage.local.remove(KEY);
  await chrome.tabs.create({ url });

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.storage.onChanged.removeListener(onChange);
      reject(new Error('timed out — finish signing in & approving on bittorrented.com'));
    }, 180000);
    function onChange(changes, area) {
      if (area === 'local' && changes[KEY]?.newValue) {
        clearTimeout(timer);
        chrome.storage.onChanged.removeListener(onChange);
        resolve(verify());
      }
    }
    chrome.storage.onChanged.addListener(onChange);
  });
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
