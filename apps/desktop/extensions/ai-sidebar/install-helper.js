// Make extension installs work on Ungoogled Chromium.
//
// Google disables its native "Add to Chrome" button on non-official Chrome, so
// it stays greyed out. We inject our own working button on extension detail
// pages: it navigates to the extension's CRX download URL, which the browser
// then offers to install thanks to the launcher pre-seeding the
// `extension-mime-request-handling = Always prompt for install` flag. If the
// flag isn't active for some reason, the CRX simply downloads and can be
// dragged onto chrome://extensions (Developer mode) instead.
//
// TronBrowser does NOT publish on the Chrome Web Store, so the button checks the
// TronBrowser store FIRST (by the page's slug/name, resolved in the background
// service worker which has host permissions). When a live TronBrowser-store
// listing exists we install from there; only when it doesn't do we fall back to
// the Chrome Web Store CRX.
//
// Before any of that, the worker checks whether the extension is ALREADY
// INSTALLED. Installing over an extension the browser already has leaves
// Chromium's install prompt spinning with nothing to complete and no way to
// dismiss it — which is exactly what the bundled MarkSyncr listing did, since the
// copy we ship unpacked claims the same id as its Web Store listing. See
// install-state.js. The button reflects what can actually succeed.

(function () {
  // Chrome extension IDs are 32 chars in a-p. New store URL:
  //   https://chromewebstore.google.com/detail/<slug>/<id>
  const DETAIL_RE = /\/detail\/(?:([^/]+)\/)?([a-p]{32})/;

  function parseDetail() {
    const m = location.pathname.match(DETAIL_RE);
    if (!m) return null;
    return { slug: m[1] || '', id: m[2] };
  }

  // The listing's human name, from the tab title ("uBlock Origin - Chrome Web
  // Store"), used as a secondary lookup key when the slug doesn't match.
  function extName() {
    return (document.title || '').replace(/\s*[-–|]\s*Chrome Web Store\s*$/i, '').trim();
  }

  function chromeVersion() {
    const m = navigator.userAgent.match(/Chrome\/(\d+)/);
    return (m ? m[1] : '120') + '.0.0.0';
  }

  function crxUrl(id) {
    return 'https://clients2.google.com/service/update2/crx?response=redirect' +
      '&acceptformat=crx2,crx3&prodversion=' + encodeURIComponent(chromeVersion()) +
      '&x=' + encodeURIComponent('id=' + id + '&installsource=ondemand&uc');
  }

  // Ask the background worker what this button should do: install from the
  // TronBrowser store, install the Chrome CRX, enable an extension that's already
  // here but off, or nothing at all because it's already running.
  //
  // Never rejects — any failure (SW asleep, offline) falls back to the plain
  // Chrome CRX install, which is exactly what this button did before the check
  // existed. An unknown answer must not make the button less capable.
  function resolveTarget(detail) {
    const fallback = {
      action: 'navigate',
      url: crxUrl(detail.id),
      label: '⬇ Add to TronBrowser',
      title: 'Install this extension (Ungoogled Chromium disables the native button)',
    };
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v || fallback); } };
      const timer = setTimeout(() => done(null), 5000); // never hang the click
      try {
        const msg = {
          type: 'resolve-install-target',
          id: detail.id,
          slug: detail.slug,
          name: extName(),
          crxUrl: fallback.url,
        };
        chrome.runtime.sendMessage(msg, (resp) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError || !resp || !resp.action) { done(null); return; }
          done(resp);
        });
      } catch (_) {
        clearTimeout(timer);
        done(null);
      }
    });
  }

  const BASE_STYLE = [
    'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483647',
    'border:0', 'border-radius:10px', 'padding:12px 18px',
    'font:700 14px ui-monospace,Menlo,monospace',
    'box-shadow:0 6px 24px rgba(0,0,0,.5)',
  ];

  // 'none' is a statement of fact, not a control: it must not look clickable, and
  // clicking it must not start an install that cannot finish.
  function paint(btn, target) {
    btn.textContent = target.label;
    btn.title = target.title;
    const inert = target.action === 'none';
    btn.disabled = inert;
    btn.style.cssText = BASE_STYLE.concat([
      inert ? 'background:#1b2431' : 'background:#34e7ff',
      inert ? 'color:#7fe9a0' : 'color:#04060c',
      inert ? 'cursor:default' : 'cursor:pointer',
      inert ? 'opacity:.95' : 'opacity:1',
    ]).join(';');
  }

  function enable(id) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      try {
        chrome.runtime.sendMessage({ type: 'enable-extension', id }, (resp) => {
          clearTimeout(timer);
          resolve(!chrome.runtime.lastError && !!resp?.ok);
        });
      } catch (_) {
        clearTimeout(timer);
        resolve(false);
      }
    });
  }

  function addButton() {
    const detail = parseDetail();
    if (!detail || document.getElementById('tron-install-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'tron-install-btn';
    btn.type = 'button';

    // Start on the plain-install look so the button is usable before the worker
    // answers, then repaint with whatever it says. Cache the promise so a click
    // never re-resolves.
    const resolved = resolveTarget(detail);
    paint(btn, {
      action: 'navigate',
      label: '⬇ Add to TronBrowser',
      title: 'Checking whether this extension is already installed…',
    });
    resolved.then((target) => paint(btn, target));

    btn.addEventListener('click', async () => {
      const target = await resolved;
      // Already installed and enabled: there is nothing an install could do.
      if (target.action === 'none') return;
      if (target.action === 'enable') {
        const ok = await enable(target.id);
        paint(btn, ok
          ? { action: 'none', label: '✓ Enabled in TronBrowser', title: 'Turned back on. Open chrome://extensions to review it.' }
          : { action: 'none', label: '✗ Could not enable', title: 'Enabling failed. Turn it on from chrome://extensions.' });
        return;
      }
      window.location.href = target.url;
    });
    document.body.appendChild(btn);
  }

  addButton();

  // The store is a single-page app — re-add the button after client-side nav.
  let last = location.pathname;
  setInterval(() => {
    if (location.pathname !== last) {
      last = location.pathname;
      const b = document.getElementById('tron-install-btn');
      if (b) b.remove();
      addButton();
    }
  }, 1000);
})();
