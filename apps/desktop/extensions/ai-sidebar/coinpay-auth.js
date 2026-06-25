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

// Persist a TronBrowser session token (from any auth method) the same way, so
// pull/push sync works identically whether you signed in with CoinPay or email.
// `method` is just for display ('coinpay' | 'email').
async function storeSession(sessionToken, method) {
  const base = await apiBase();
  let label = '';
  try {
    const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${sessionToken}` } });
    if (me.ok) { const d = await me.json(); label = d.email || d.id || ''; }
  } catch { /* ignore */ }
  await chrome.storage.local.set({
    coinpay: { sessionToken, label, method, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 },
  });
  return label;
}

export async function coinpaySignIn() {
  const base = await apiBase();
  const redirectUri = chrome.identity.getRedirectURL();
  const url = `${base}/api/auth/coinpay/login?redirect=${encodeURIComponent(redirectUri)}`;
  const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  const frag = new URL(redirect).hash.slice(1) || new URL(redirect).search.slice(1);
  const sessionToken = new URLSearchParams(frag).get('token');
  if (!sessionToken) throw new Error('no session token returned');
  await storeSession(sessionToken, 'coinpay');
  return true;
}

// Email + password sign-in — same /api/auth/login the website uses; the server
// returns a session token we store exactly like the CoinPay one.
export async function emailSignIn(email, password) {
  const base = await apiBase();
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.token) throw new Error(d.error || `sign-in failed (${r.status})`);
  await storeSession(d.token, 'email');
  return { emailVerified: !!d.emailVerified };
}

// Email + password sign-up — same /api/auth/signup the website uses. This sends
// a verification email and does NOT sign you in; verify, then sign in.
export async function emailSignUp(email, password) {
  const base = await apiBase();
  const r = await fetch(`${base}/api/auth/signup`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `sign-up failed (${r.status})`);
  return { message: d.message || 'verification email sent — verify, then sign in' };
}

export async function coinpayState() {
  const { coinpay } = await chrome.storage.local.get('coinpay');
  if (coinpay?.sessionToken && (!coinpay.expiresAt || coinpay.expiresAt > Date.now())) {
    return { signedIn: true, label: coinpay.label, method: coinpay.method || 'coinpay', token: coinpay.sessionToken };
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
