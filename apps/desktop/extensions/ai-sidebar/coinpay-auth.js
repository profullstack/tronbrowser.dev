// CoinPay OAuth (Authorization Code + PKCE) via chrome.identity. This is the
// TronBrowser login — NOT Google. Endpoints default to hosted CoinPay and are
// overridable for self-hosted CoinPay in Settings.
const DEFAULTS = {
  authorizeUrl: 'https://coinpay.profullstack.com/oauth/authorize',
  tokenUrl: 'https://coinpay.profullstack.com/oauth/token',
  scopes: ['wallet:read', 'payments:x402'],
};

async function cfg() {
  const { coinpayConfig } = await chrome.storage.local.get('coinpayConfig');
  return {
    clientId: coinpayConfig?.clientId || 'tronbrowser',
    authorizeUrl: coinpayConfig?.authorizeUrl || DEFAULTS.authorizeUrl,
    tokenUrl: coinpayConfig?.tokenUrl || DEFAULTS.tokenUrl,
  };
}

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

export async function coinpaySignIn() {
  const c = await cfg();
  const redirectUri = chrome.identity.getRedirectURL();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const { verifier, challenge } = await pkce();

  const u = new URL(c.authorizeUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', c.clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', DEFAULTS.scopes.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');

  const redirect = await chrome.identity.launchWebAuthFlow({ url: u.toString(), interactive: true });
  const params = new URL(redirect).searchParams;
  if (params.get('state') !== state) throw new Error('state mismatch');
  const code = params.get('code');
  if (!code) throw new Error(params.get('error') || 'no authorization code');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: c.clientId,
    code_verifier: verifier,
  });
  const res = await fetch(c.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error('token exchange failed (' + res.status + ')');
  const tok = await res.json();
  await chrome.storage.local.set({
    coinpay: {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: Date.now() + (tok.expires_in ? tok.expires_in * 1000 : 3600000),
      label: tok.email || tok.sub || '',
    },
  });
  return true;
}

export async function coinpayState() {
  const { coinpay } = await chrome.storage.local.get('coinpay');
  if (coinpay?.accessToken && coinpay.expiresAt > Date.now()) {
    return { signedIn: true, label: coinpay.label, token: coinpay.accessToken };
  }
  return { signedIn: false };
}

export async function coinpaySignOut() {
  await chrome.storage.local.remove('coinpay');
}
