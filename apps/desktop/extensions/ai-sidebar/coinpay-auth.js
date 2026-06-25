// CoinPay sign-in via the TronBrowser backend (confidential OAuth client — the
// client secret lives only on the server). The extension opens the backend
// login URL through chrome.identity; the backend does the CoinPay OAuth dance
// and redirects back with a TronBrowser session token. This is the login —
// never Google. Override the API base in Settings (self-hosted backend).
const DEFAULT_API = 'https://tronbrowser.dev';

async function apiBase() {
  const { syncConfig } = await chrome.storage.local.get('syncConfig');
  return (syncConfig?.url || DEFAULT_API).replace(/\/$/, '');
}

export async function coinpaySignIn() {
  const base = await apiBase();
  const redirectUri = chrome.identity.getRedirectURL();
  const url = `${base}/api/auth/coinpay/login?redirect=${encodeURIComponent(redirectUri)}`;
  const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  const frag = new URL(redirect).hash.slice(1) || new URL(redirect).search.slice(1);
  const sessionToken = new URLSearchParams(frag).get('token');
  if (!sessionToken) throw new Error('no session token returned');
  // Pull the account profile.
  let label = '';
  try {
    const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${sessionToken}` } });
    if (me.ok) { const d = await me.json(); label = d.email || d.id || ''; }
  } catch { /* ignore */ }
  await chrome.storage.local.set({
    coinpay: { sessionToken, label, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 },
  });
  return true;
}

export async function coinpayState() {
  const { coinpay } = await chrome.storage.local.get('coinpay');
  if (coinpay?.sessionToken && (!coinpay.expiresAt || coinpay.expiresAt > Date.now())) {
    return { signedIn: true, label: coinpay.label, token: coinpay.sessionToken };
  }
  return { signedIn: false };
}

export async function coinpaySignOut() {
  const { coinpay } = await chrome.storage.local.get('coinpay');
  if (coinpay?.sessionToken) {
    try {
      const base = await apiBase();
      await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${coinpay.sessionToken}` } });
    } catch { /* ignore */ }
  }
  await chrome.storage.local.remove('coinpay');
}
