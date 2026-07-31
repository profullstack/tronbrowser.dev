// CoinPay sign-in via the TronBrowser backend (confidential OAuth client — the
// client secret lives only on the server). The extension opens the backend
// login URL in a normal tab; the backend reuses your existing website session
// (or does the CoinPay OAuth dance) and redirects back to /ext-callback.html,
// where our content script hands the session token to the extension. This is
// the login — never Google. Override the API base in Settings (self-hosted).
const DEFAULT_API = 'https://tronbrowser.dev';

// Landing page for the redirect, and the storage key its content script writes.
// The path MUST stay on the API origin: the server only honors same-origin
// redirect targets (safeRedirect), and ext-callback.js is only injected into
// tronbrowser.dev/ext-callback*.
const CALLBACK_PATH = '/ext-callback.html?src=tb';
const HANDOFF_KEY = 'tbAuthToken';
const SIGNIN_TIMEOUT_MS = 180000;

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

// Wait for the ext-callback content script to drop the session token into
// storage. Same pattern as bittorrented.js: the content script writes storage
// directly, because an MV3 service worker can drop a message while waking up.
function waitForToken() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.storage.onChanged.removeListener(onChange);
      reject(new Error('timed out — finish signing in on tronbrowser.dev'));
    }, SIGNIN_TIMEOUT_MS);
    function onChange(changes, area) {
      if (area !== 'local' || !changes[HANDOFF_KEY]?.newValue) return;
      clearTimeout(timer);
      chrome.storage.onChanged.removeListener(onChange);
      resolve(changes[HANDOFF_KEY].newValue);
    }
    chrome.storage.onChanged.addListener(onChange);
  });
}

// We deliberately do NOT use chrome.identity.launchWebAuthFlow. Its redirect
// URL (https://<ext-id>.chromiumapp.org/) is off-origin, and the API's
// safeRedirect() only honors same-origin targets — so the server dropped the
// redirect and fell back to `${APP_URL}/?signedin=1`, leaving the WEBSITE
// signed in and the extension with nothing. (Ungoogled Chromium also rewrites
// chromiumapp.org to a non-resolving .qjz9zk host.) Instead we open the login
// in a tab and collect the token from our own /ext-callback.html.
export async function coinpaySignIn() {
  const base = await apiBase();
  const redirect = `${base}${CALLBACK_PATH}`;
  const url = `${base}/api/auth/ext-login?redirect=${encodeURIComponent(redirect)}`;
  await chrome.storage.local.remove(HANDOFF_KEY);
  const pending = waitForToken();          // listen BEFORE the tab can redirect
  await chrome.tabs.create({ url });
  const sessionToken = await pending;
  await chrome.storage.local.remove(HANDOFF_KEY); // handoff key is transient
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
