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

  // Ask the background worker whether the TronBrowser store has this extension.
  // Resolves to a Tron-store download URL, or null to use the Chrome CRX. Never
  // rejects — any failure (SW asleep, offline, not listed) falls back to Chrome.
  function resolveTronDownload(slug, name) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      const timer = setTimeout(() => done(null), 5000); // never hang the click
      try {
        chrome.runtime.sendMessage({ type: 'resolve-tron-store', slug, name }, (resp) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError || !resp || !resp.found || !resp.downloadUrl) { done(null); return; }
          done(resp.downloadUrl);
        });
      } catch (_) {
        clearTimeout(timer);
        done(null);
      }
    });
  }

  function addButton() {
    const detail = parseDetail();
    if (!detail || document.getElementById('tron-install-btn')) return;
    const { slug, id } = detail;
    const btn = document.createElement('button');
    btn.id = 'tron-install-btn';
    btn.type = 'button';
    btn.textContent = '⬇ Add to TronBrowser';
    btn.title = 'Install this extension (Ungoogled Chromium disables the native button)';
    // Programmatic CSSOM styling — not subject to the page's CSP.
    btn.style.cssText = [
      'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483647',
      'background:#34e7ff', 'color:#04060c', 'border:0', 'border-radius:10px',
      'padding:12px 18px', 'font:700 14px ui-monospace,Menlo,monospace',
      'cursor:pointer', 'box-shadow:0 6px 24px rgba(0,0,0,.5)',
    ].join(';');

    // Resolve the TronBrowser store up front so the button reflects where the
    // install will come from; cache the promise so a click never re-resolves.
    const tronTarget = resolveTronDownload(slug, extName());
    tronTarget.then((url) => {
      if (url) {
        btn.textContent = '⬇ Add from TronBrowser Store';
        btn.title = 'Install from the TronBrowser store (not published on the Chrome Web Store)';
      }
    });

    btn.addEventListener('click', async () => {
      // Tron store FIRST, Chrome Web Store CRX as the fallback.
      const url = (await tronTarget) || crxUrl(id);
      window.location.href = url;
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
