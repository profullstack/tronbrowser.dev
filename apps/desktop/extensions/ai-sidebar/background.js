import { decideInstallTarget, lookupInstalled } from './install-state.js';
import { PIT_SOCKS_PORT, pitProxyConfig } from './pit-proxy.js';
import { installPush } from './push-client.js';
import { PIT_DIRECT_RULES, w3bsFromSearch } from './w3bs.js';

// Web Push through TronBrowser's configured push service (the engine has none).
installPush();

// A w3bs:// URI typed in the address bar becomes a web search. w3bs-rules.json
// redirects that search before it loads, but not when the omnibox serves it
// from its search prefetch, so catch whatever a tab lands on as well.
chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (!change.url || !/w3bs/i.test(change.url)) return;
  const { pitEnabled } = await chrome.storage.local.get('pitEnabled');
  const target = w3bsFromSearch(change.url, { pit: !!pitEnabled });
  if (target) chrome.tabs.update(tabId, { url: target }).catch(() => {});
});

// With Pit on, w3bs://chovy.hacker opens chovy.hacker itself instead of its
// pit.world gateway. Session rules, kept in step with the toggle.
async function syncW3bsPitRules() {
  const { pitEnabled } = await chrome.storage.local.get('pitEnabled');
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: PIT_DIRECT_RULES.map((rule) => rule.id),
    addRules: pitEnabled ? PIT_DIRECT_RULES : [],
  });
}
syncW3bsPitRules().catch((err) => console.warn('w3bs pit rules:', err));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'pitEnabled' in changes) {
    syncW3bsPitRules().catch((err) => console.warn('w3bs pit rules:', err));
  }
});

// Open the AI side panel when the toolbar action is clicked.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.warn('sidePanel behavior:', err));

chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel?.open && tab?.id != null) {
    chrome.sidePanel.open({ tabId: tab.id }).catch((err) => console.warn('sidePanel open:', err));
  }
});

// First run with no AI model configured → open settings so keys can be set.
chrome.runtime.onInstalled.addListener(async () => {
  const { aiConfig } = await chrome.storage.local.get('aiConfig');
  if (!aiConfig || !aiConfig.model) chrome.runtime.openOptionsPage();
});

// --- Extension store resolution (Tron store first, Chrome Web Store fallback) -
// The install-helper content script runs on Chrome Web Store detail pages. Since
// we do NOT publish on the Chrome Web Store, its "Add to TronBrowser" button must
// prefer the TronBrowser store: given the extension's slug/name, check
// tronbrowser.dev's store and, when a live listing exists, install from there;
// otherwise the content script falls back to the Chrome Web Store CRX.
//
// We resolve here in the background (not the content script) because the SW has
// host permissions for tronbrowser.dev, so the fetch isn't blocked by the store
// page's CSP/CORS.
const TRON_STORE_API = 'https://tronbrowser.dev/api/store';

// A listing is installable only if it's live and has a downloadable artifact.
function tronListingUsable(ext) {
  return !!(ext && ext.status === 'live' && ext.version && (ext.version.crxUrl || ext.version.bundleUrl));
}

async function fetchTronListing(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${TRON_STORE_API}${path}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch (_) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Look the extension up in the TronBrowser store. The Chrome Web Store slug
// usually matches the store slug for extensions we've republished; if it doesn't,
// fall back to a name search and require an exact slug/name match (never install
// an unrelated result). Returns the usable listing, or null.
async function resolveTronStore(slug, name) {
  if (slug) {
    const ext = await fetchTronListing(`/extensions/${encodeURIComponent(slug)}`);
    if (tronListingUsable(ext)) return ext;
  }
  const q = (name || slug || '').trim();
  if (q) {
    const data = await fetchTronListing(`/extensions?q=${encodeURIComponent(q)}`);
    const list = (data && data.extensions) || [];
    const nlc = (name || '').toLowerCase();
    const hit =
      (slug && list.find((e) => e.slug === slug)) ||
      (nlc && list.find((e) => (e.name || '').toLowerCase() === nlc)) ||
      null;
    if (tronListingUsable(hit)) return hit;
  }
  return null;
}

// Let pages (e.g. the new tab) ask to open the side panel.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'resolve-install-target') {
    (async () => {
      // The installed check comes first and decides the answer on its own: an
      // extension already in this browser cannot be installed over, from either
      // store, and offering it is what leaves the prompt spinning. chrome.management
      // is only reachable here — content scripts don't get the API.
      const [installed, ext] = await Promise.all([
        lookupInstalled(msg.id),
        resolveTronStore(msg.slug, msg.name).catch(() => null),
      ]);
      sendResponse(
        decideInstallTarget({
          installed,
          tronDownloadUrl: ext
            ? `${TRON_STORE_API}/extensions/${encodeURIComponent(ext.slug)}/download`
            : null,
          crxUrl: msg.crxUrl,
        }),
      );
    })();
    return true; // async sendResponse
  }

  // Turn an installed-but-disabled extension back on, for the store page's button.
  // Only the service worker holds the management permission.
  if (msg?.type === 'enable-extension' && msg.id) {
    (async () => {
      try {
        await chrome.management.setEnabled(msg.id, true);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true; // async sendResponse
  }

  if (msg?.type === 'open-sidepanel' && chrome.sidePanel?.open) {
    const opts = sender.tab?.id != null ? { tabId: sender.tab.id } : {};
    chrome.sidePanel.open(opts).catch((err) => console.warn('sidePanel open:', err));
  }

  // Token-grant callback: the ext-callback content script captured a token from
  // the redirect fragment and told us which flow it belongs to ('tbAuthToken'
  // for TronBrowser sign-in, 'btrToken' for bittorrented.com). It already stored
  // it — we mirror the write for safety and close the tab.
  if (msg?.type === 'ext-token' && msg.token) {
    chrome.storage.local.set({ [msg.key || 'btrToken']: msg.token });
    if (sender.tab?.id != null) chrome.tabs.remove(sender.tab.id).catch(() => {});
  }
});

// --- Tor toggle ----------------------------------------------------------
// Routes the LIVE session through the local Tor SOCKS5 proxy via chrome.proxy —
// no relaunch, no second instance. Mirrors src/tor-proxy.ts. The extension can
// re-route traffic but CANNOT start the daemon, so the toggle expects Tor on
// 127.0.0.1:9071 (TronBrowser's own port) and verifies via check.torproject.org.
// This is convenience routing, NOT Tor-Browser-grade anonymity — see
// docs/tor-onion-mode.md.
const TOR_SOCKS_PORT = 9071;
const TOR_CHECK_URL = 'https://check.torproject.org/api/ip';
// Loopback control helper the launcher runs (launcher/tron-tor-helper). It
// starts the Tor daemon ON DEMAND so the toggle "just works" — nobody connects
// to Tor until the user flips it on.
const TOR_HELPER = 'http://127.0.0.1:9061';

async function helperJson(path, method) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${TOR_HELPER}${path}`, { method, signal: ctrl.signal });
    return await res.json().catch(() => ({}));
  } finally {
    clearTimeout(t);
  }
}

// Kick Tor off (non-blocking). Returns the helper's initial status, or
// { error:'unreachable' } when the helper isn't running.
async function startTorViaHelper() {
  try {
    return await helperJson('/start', 'POST');
  } catch (_) {
    return { error: 'unreachable' };
  }
}

// Poll the helper's bootstrap until ready / error / timeout, reporting live
// progress (0..100) via onProgress. Returns { ready } or { error }.
async function waitForTor(onProgress, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let st;
    try {
      st = await helperJson('/status', 'GET');
    } catch (_) {
      return { error: 'unreachable' };
    }
    if (typeof st.progress === 'number') onProgress(st.progress);
    if (st.ready) return { ready: true };
    if (st.error) return { error: st.error }; // tor exited with a reason
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { error: 'tor-starting' };
}

async function stopTorViaHelper() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    await fetch(`${TOR_HELPER}/stop`, { method: 'POST', signal: ctrl.signal });
    clearTimeout(t);
  } catch (_) { /* helper not running — nothing to stop */ }
}

function torProxyConfig(port) {
  return {
    mode: 'fixed_servers',
    rules: {
      // SOCKS5 → Chromium resolves DNS at the proxy, so .onion resolves inside
      // Tor and names never leak.
      singleProxy: { scheme: 'socks5', host: '127.0.0.1', port },
      // Loopback must bypass Tor: the SOCKS port + the control helper are on
      // 127.0.0.1, and Tor refuses to proxy private addresses anyway. Nothing
      // else bypasses — every other host goes through the proxy.
      bypassList: ['localhost', '127.0.0.1', '[::1]'],
    },
  };
}

async function setTorBadge(on) {
  try {
    await chrome.action.setBadgeText({ text: on ? 'TOR' : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#7d4698' }); // Tor purple
    await chrome.action.setTitle({ title: on ? 'TronBrowser — Tor ON' : 'TronBrowser' });
  } catch (_) { /* action API may be unavailable */ }
}

async function enableTor() {
  await chrome.proxy.settings.set({ value: torProxyConfig(TOR_SOCKS_PORT), scope: 'regular' });
  // Stop WebRTC from leaking the real IP via non-proxied UDP.
  try {
    await chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: 'disable_non_proxied_udp' });
  } catch (_) { /* privacy controlled elsewhere */ }
  await chrome.storage.local.set({ torEnabled: true });
  // session storage is wiped on browser restart → marks Tor as on THIS session.
  try { await chrome.storage.session.set({ torSession: true }); } catch (_) { /* no-op */ }
  await setTorBadge(true);
}

async function disableTor() {
  // Force the proxy back to the OS/default FIRST. clear() alone can leave the
  // fixed_servers config active → once Tor stops the browser dies with
  // ERR_PROXY_CONNECTION_FAILED. Setting 'system' guarantees normal browsing.
  try {
    await chrome.proxy.settings.set({ value: { mode: 'system' }, scope: 'regular' });
  } catch (_) { /* fall through to clear */ }
  try { await chrome.proxy.settings.clear({ scope: 'regular' }); } catch (_) { /* already clear */ }
  try { await chrome.privacy.network.webRTCIPHandlingPolicy.clear({}); } catch (_) { /* already clear */ }
  await chrome.storage.local.set({ torEnabled: false });
  try { await chrome.storage.session.remove('torSession'); } catch (_) { /* no-op */ }
  await setTorBadge(false);
}

// Confirm traffic actually exits via Tor — the proxy is set, but the daemon may
// not be running. {ok, isTor, ip} on success, {ok:false, error} otherwise.
async function checkTor() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000); // fresh Tor circuits can be slow
    const res = await fetch(TOR_CHECK_URL, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    const data = await res.json();
    return { ok: true, isTor: !!data.IsTor, ip: data.IP };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'tor-set') {
    (async () => {
      if (msg.on) {
        // Tor and the pit are exclusive: the pit's PAC asks the system resolver
        // about every host, which under Tor would leak lookups outside it.
        const { pitEnabled } = await chrome.storage.local.get('pitEnabled');
        if (pitEnabled) {
          await disablePit();
          await stopPitViaHelper();
        }
        const started = await startTorViaHelper();
        if (started.error === 'unreachable') {
          sendResponse({ enabled: false, started: { error: 'unreachable' } });
          return;
        }
        if (started.error === 'tor-not-installed') {
          sendResponse({ enabled: false, started: { error: 'tor-not-installed' } });
          return;
        }
        // Poll bootstrap, pushing live progress to the sidebar's progress bar.
        const result = await waitForTor((pct) => {
          chrome.runtime.sendMessage({ type: 'tor-progress', pct }).catch(() => {});
        });
        if (result.ready) {
          await enableTor();
          const check = await checkTor();
          sendResponse({ enabled: true, check });
        } else {
          sendResponse({ enabled: false, started: { error: result.error } });
        }
      } else {
        await disableTor();
        await stopTorViaHelper();
        sendResponse({ enabled: false });
      }
    })();
    return true; // async sendResponse
  }
  if (msg?.type === 'tor-status') {
    (async () => {
      const { torEnabled } = await chrome.storage.local.get('torEnabled');
      sendResponse({ enabled: !!torEnabled });
    })();
    return true;
  }
});

// --- Pit toggle ----------------------------------------------------------
// W3BS Net is primary for recognized names; Moshpit is the backfill. For a
// bare W3BS name (fumb.duck), route to its W3BS host or published target before
// DNS. If W3BS has no record, the PAC and SOCKS helper use Moshpit resolution.
// All of this is scoped to this browser session and only runs while Pit is on.
const W3BS_NET_RESOLVE = 'https://w3bs.org/api/net/v1/resolve/';
const W3BS_NET_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const W3BS_HOST_SUFFIX = '.w3bs.org';
const pitNavigationGeneration = new Map();
const pitNavigationPending = new Set();
const pitNavigationChains = new Map();

function w3bsNameForHost(host) {
  const lower = String(host || '').toLowerCase().replace(/\.$/, '');
  if (lower.endsWith(W3BS_HOST_SUFFIX)) {
    const name = lower.slice(0, -W3BS_HOST_SUFFIX.length);
    return W3BS_NET_NAME.test(name) ? { name } : null;
  }
  return W3BS_NET_NAME.test(lower) ? { name: lower } : null;
}

function appendNetPath(destination, source) {
  const target = new URL(destination);
  const incoming = new URL(source);
  if (incoming.pathname !== '/') {
    target.pathname = `${target.pathname.replace(/\/+$/, '')}/${incoming.pathname.replace(/^\/+/, '')}`;
  }
  if (incoming.search) target.search = incoming.search;
  if (incoming.hash) target.hash = incoming.hash;
  return target.href;
}

async function w3bsNetRecord(name) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${W3BS_NET_RESOLVE}${encodeURIComponent(name)}`, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function routeW3bsNetNavigation(details) {
  if (details.frameId !== 0 || details.tabId < 0) return;
  const pendingKey = `${details.tabId}:${details.url}`;
  if (pitNavigationPending.has(pendingKey)) return;
  const generation = (pitNavigationGeneration.get(details.tabId) || 0) + 1;
  pitNavigationGeneration.set(details.tabId, generation);

  let incoming;
  try {
    incoming = new URL(details.url);
  } catch (_) {
    return;
  }
  if (incoming.protocol !== 'https:') return;
  const candidate = w3bsNameForHost(incoming.hostname);
  if (!candidate) return;

  pitNavigationPending.add(pendingKey);
  try {
    const { pitEnabled } = await chrome.storage.local.get('pitEnabled');
    if (!pitEnabled || pitNavigationGeneration.get(details.tabId) !== generation) return;

    const record = await w3bsNetRecord(candidate.name);
    if (!record || pitNavigationGeneration.get(details.tabId) !== generation) return;

    let base;
    let preservePath = true;
    if (record.source === 'w3bs') {
      if (record.status !== 'active') {
        base = `https://w3bs.org/net?q=${encodeURIComponent(candidate.name)}`;
        preservePath = false;
      } else if (typeof record.target === 'string' && record.target) {
        try {
          const target = new URL(record.target);
          if (target.protocol !== 'https:' || target.username || target.password) return;
          base = target.href;
        } catch (_) {
          return;
        }
      } else {
        base = `https://${candidate.name}.w3bs.org/`;
      }
    } else if (record.source === 'moshpit') {
      // W3BS Net imported this name as backfill; its public gateway carries the
      // name and path without asking ordinary DNS to resolve the Moshpit TLD.
      const resolved = typeof record.resolved === 'string' && W3BS_NET_NAME.test(record.resolved)
        ? record.resolved
        : candidate.name;
      base = `https://${resolved}.pit.world/`;
    } else {
      return;
    }

    const destination = preservePath ? appendNetPath(base, details.url) : base;
    if (destination === details.url || pitNavigationGeneration.get(details.tabId) !== generation) return;

    const chain = pitNavigationChains.get(details.tabId) || { seen: new Set(), expiresAt: 0 };
    if (chain.expiresAt < Date.now()) chain.seen.clear();
    if (chain.seen.has(incoming.hostname)) return;
    chain.seen.add(incoming.hostname);
    chain.expiresAt = Date.now() + 15000;
    pitNavigationChains.set(details.tabId, chain);

    await chrome.tabs.update(details.tabId, { url: destination });
  } catch (_) {
    // A lookup or redirect failure leaves the existing Moshpit/clearnet path
    // alone; the W3BS check must never block normal navigation.
  } finally {
    pitNavigationPending.delete(pendingKey);
  }
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  void routeW3bsNetNavigation(details);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    pitNavigationChains.delete(tabId);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  pitNavigationChains.delete(tabId);
  pitNavigationGeneration.delete(tabId);
  for (const key of pitNavigationPending) if (key.startsWith(`${tabId}:`)) pitNavigationPending.delete(key);
});

async function setPitBadge(on) {
  try {
    await chrome.action.setBadgeText({ text: on ? 'PIT' : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#a6ff1a' }); // moshcode acid
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#0a1400' });
    await chrome.action.setTitle({ title: on ? 'TronBrowser — Pit ON' : 'TronBrowser' });
  } catch (_) { /* action API may be unavailable */ }
}

async function enablePit() {
  await chrome.proxy.settings.set({ value: pitProxyConfig(PIT_SOCKS_PORT), scope: 'regular' });
  await chrome.storage.local.set({ pitEnabled: true });
  try { await chrome.storage.session.set({ pitSession: true }); } catch (_) { /* no-op */ }
  await setPitBadge(true);
}

async function disablePit() {
  // Only hand the proxy back to the OS when Tor is not holding it.
  const { torEnabled } = await chrome.storage.local.get('torEnabled');
  if (!torEnabled) {
    try {
      await chrome.proxy.settings.set({ value: { mode: 'system' }, scope: 'regular' });
    } catch (_) { /* fall through to clear */ }
    try { await chrome.proxy.settings.clear({ scope: 'regular' }); } catch (_) { /* already clear */ }
  }
  await chrome.storage.local.set({ pitEnabled: false });
  try { await chrome.storage.session.remove('pitSession'); } catch (_) { /* no-op */ }
  await setPitBadge(false);
}

// The launcher replaces an out-of-date helper in the background right after
// launch (kill, settle, exec). A click in that window reaches the OLD helper,
// which has no /pit/* routes and answers 404 {"error":"not-found"}, or reaches
// nobody at all. Both are transient, so try for a few seconds before giving up,
// and say "stale helper" rather than "couldn't start" when it never catches up.
const PIT_START_ATTEMPTS = 5;
const PIT_START_RETRY_MS = 2000;

function pitHelperIsStale(res) {
  return !res || res.error === 'not-found' || (!res.started && typeof res.port !== 'number');
}

async function startPitViaHelper() {
  let last = null;
  for (let i = 0; i < PIT_START_ATTEMPTS; i++) {
    if (i) await new Promise((r) => setTimeout(r, PIT_START_RETRY_MS));
    try {
      last = await helperJson('/pit/start', 'POST');
    } catch (_) {
      last = { error: 'unreachable' };
      continue;
    }
    if (!pitHelperIsStale(last)) return last; // a pit-capable helper answered, ok or not
  }
  if (last && last.error === 'unreachable') return last;
  return { started: false, error: 'helper-stale' };
}

async function stopPitViaHelper() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    await fetch(`${TOR_HELPER}/pit/stop`, { method: 'POST', signal: ctrl.signal });
    clearTimeout(t);
  } catch (_) { /* helper not running — nothing to stop */ }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'pit-set') {
    (async () => {
      if (msg.on) {
        const { torEnabled } = await chrome.storage.local.get('torEnabled');
        if (torEnabled) {
          sendResponse({ enabled: false, error: 'tor-on' });
          return;
        }
        const started = await startPitViaHelper();
        if (!started.started) {
          sendResponse({ enabled: false, error: started.error || 'pit-failed' });
          return;
        }
        await enablePit();
        sendResponse({ enabled: true, check: started.check || null, trust: started.trust || null, port: started.port });
      } else {
        await disablePit();
        await stopPitViaHelper();
        sendResponse({ enabled: false });
      }
    })();
    return true; // async sendResponse
  }
  if (msg?.type === 'pit-status') {
    (async () => {
      const { pitEnabled } = await chrome.storage.local.get('pitEnabled');
      sendResponse({ enabled: !!pitEnabled });
    })();
    return true;
  }
});

// Tor and the pit default OFF on every fresh browser start — nobody is routed
// anywhere unless they flip a toggle. chrome.storage.session is wiped on
// browser restart, so it tells a fresh launch from a service-worker restart
// mid-session.
(async () => {
  try {
    const { torSession, pitSession } = await chrome.storage.session.get(['torSession', 'pitSession']);
    if (torSession) {
      // Same session, SW just restarted → keep Tor on (re-apply the proxy).
      await enableTor();
    } else if (pitSession) {
      await enablePit();
    } else {
      // Fresh browser start. If local still says a toggle was on (carried over
      // from the last run), clear it + any persisted proxy. Otherwise leave the
      // proxy untouched.
      const { torEnabled, pitEnabled } = await chrome.storage.local.get(['torEnabled', 'pitEnabled']);
      if (torEnabled) await disableTor();
      else if (pitEnabled) { await disablePit(); await stopPitViaHelper(); }
    }
  } catch (_) { /* best effort */ }
})();
