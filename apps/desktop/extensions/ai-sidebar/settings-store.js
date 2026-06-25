// Settings sync. Source of truth for offline = chrome.storage.local; on top of
// that we sync to a backend keyed by the CoinPay-authenticated (anonymous) user:
//   - self-hosted backend if a URL is configured in Settings;
//   - otherwise OUR managed cloud (Turso-backed) API.
// Local always works; remote is best-effort (no crash if the backend is down).
import { coinpayState } from './coinpay-auth.js';

// Managed cloud sync API (Turso-backed), served at tronbrowser.dev/api. Remote
// calls fail quietly (settings stay local) if unreachable.
const CLOUD_BASE = 'https://tronbrowser.dev';

// Keys that sync. NOTE: plaintext API keys (aiConfig/aiProviders) are NEVER
// synced — only the E2E-encrypted vault (aiVault) plus non-sensitive prefs.
const KEYS = ['aiVault', 'aiDefault', 'aiModel', 'feeds', 'coinpayConfig', 'tickers', 'leagues'];

async function endpoint() {
  const { syncConfig } = await chrome.storage.local.get('syncConfig');
  if (syncConfig?.url) return { base: syncConfig.url.replace(/\/$/, ''), mode: 'self-hosted' };
  return { base: CLOUD_BASE, mode: 'cloud' };
}

/** Pull cloud settings into local storage (call after sign-in). */
export async function pullSettings() {
  const st = await coinpayState();
  if (!st.signedIn) return { ok: false, reason: 'not-signed-in' };
  const { base } = await endpoint();
  try {
    const res = await fetch(`${base}/api/settings`, { headers: { authorization: `Bearer ${st.token}` } });
    if (!res.ok) return { ok: false, reason: `http ${res.status}` };
    const data = await res.json();
    const patch = {};
    for (const k of KEYS) if (data[k] !== undefined) patch[k] = data[k];
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** Push local settings to the cloud (call after any settings change). */
export async function pushSettings() {
  const st = await coinpayState();
  if (!st.signedIn) return { ok: false, reason: 'not-signed-in' };
  const { base } = await endpoint();
  const local = await chrome.storage.local.get(KEYS);
  try {
    const res = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${st.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(local),
    });
    return { ok: res.ok, reason: res.ok ? undefined : `http ${res.status}` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
