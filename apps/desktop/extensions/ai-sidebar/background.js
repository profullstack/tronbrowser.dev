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

// Let pages (e.g. the new tab) ask to open the side panel.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'open-sidepanel' && chrome.sidePanel?.open) {
    const opts = sender.tab?.id != null ? { tabId: sender.tab.id } : {};
    chrome.sidePanel.open(opts).catch((err) => console.warn('sidePanel open:', err));
  }

  // bittorrented.com connect callback: the ext-callback content script captured
  // the API token from the redirect fragment. Store it and close the tab.
  if (msg?.type === 'btr-token' && msg.token) {
    chrome.storage.local.set({ btrToken: msg.token });
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
      // 127.0.0.1, and Tor refuses to proxy private addresses anyway.
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

// Tor defaults OFF on every fresh browser start — nobody is routed through Tor
// unless they flip the toggle. chrome.storage.session is wiped on browser
// restart, so it tells a fresh launch from a service-worker restart mid-session.
(async () => {
  try {
    const { torSession } = await chrome.storage.session.get('torSession');
    if (torSession) {
      // Same session, SW just restarted → keep Tor on (re-apply the proxy).
      await enableTor();
    } else {
      // Fresh browser start. If local still says Tor was on (carried over from
      // the last run), clear it + any persisted proxy. Otherwise leave the
      // proxy untouched.
      const { torEnabled } = await chrome.storage.local.get('torEnabled');
      if (torEnabled) await disableTor();
    }
  } catch (_) { /* best effort */ }
})();
