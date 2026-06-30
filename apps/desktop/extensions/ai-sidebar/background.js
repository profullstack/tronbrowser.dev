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
// 127.0.0.1:9050 (start it with `tron tor`) and verifies via check.torproject.org.
// This is convenience routing, NOT Tor-Browser-grade anonymity — see
// docs/tor-onion-mode.md.
const TOR_SOCKS_PORT = 9050;
const TOR_CHECK_URL = 'https://check.torproject.org/api/ip';
// Loopback control helper the launcher runs (launcher/tron-tor-helper). It
// starts the Tor daemon ON DEMAND so the toggle "just works" — nobody connects
// to Tor until the user flips it on.
const TOR_HELPER = 'http://127.0.0.1:9061';

// Ask the helper to start Tor and block until it's bootstrapped. Returns
// { ok, error? }; { ok:false, error:'unreachable' } when the helper isn't running.
async function startTorViaHelper() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 75000); // tor bootstrap can take ~60s
    const res = await fetch(`${TOR_HELPER}/start`, { method: 'POST', signal: ctrl.signal });
    clearTimeout(t);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ready !== false, error: data.error };
  } catch (_) {
    return { ok: false, error: 'unreachable' };
  }
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
  await setTorBadge(true);
}

async function disableTor() {
  try { await chrome.proxy.settings.clear({ scope: 'regular' }); } catch (_) { /* already clear */ }
  try { await chrome.privacy.network.webRTCIPHandlingPolicy.clear({}); } catch (_) { /* already clear */ }
  await chrome.storage.local.set({ torEnabled: false });
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
        if (started.ok) {
          // The daemon bootstrapped → route through it and TRUST it. The
          // check.torproject.org probe is only a confirmation; a slow/blocked
          // probe must NOT tear down a working Tor session.
          await enableTor();
          const check = await checkTor();
          sendResponse({ enabled: true, started, check });
        } else if (started.error === 'unreachable') {
          // No control helper — maybe the user runs their own Tor. Try, but
          // here we DO require the probe to confirm before committing.
          await enableTor();
          const check = await checkTor();
          if (check.ok && check.isTor) {
            sendResponse({ enabled: true, started, check });
          } else {
            await disableTor();
            sendResponse({ enabled: false, started, check });
          }
        } else {
          // tor-not-installed / tor-exited / spawn error → can't route.
          sendResponse({ enabled: false, started });
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

// Re-apply the proxy when the service worker wakes if Tor was left on (extension
// proxy settings don't always survive a browser restart). Idempotent.
(async () => {
  try {
    const { torEnabled } = await chrome.storage.local.get('torEnabled');
    if (torEnabled) await enableTor();
  } catch (_) { /* best effort */ }
})();
