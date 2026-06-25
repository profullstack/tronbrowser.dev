// Make Chrome Web Store installs work on Ungoogled Chromium.
//
// Google disables its native "Add to Chrome" button on non-official Chrome, so
// it stays greyed out. We inject our own working button on extension detail
// pages: it navigates to the extension's CRX download URL, which the browser
// then offers to install thanks to the launcher pre-seeding the
// `extension-mime-request-handling = Always prompt for install` flag. If the
// flag isn't active for some reason, the CRX simply downloads and can be
// dragged onto chrome://extensions (Developer mode) instead.

(function () {
  // Chrome extension IDs are 32 chars in a-p. New store URL:
  //   https://chromewebstore.google.com/detail/<slug>/<id>
  const ID_RE = /\/detail\/(?:[^/]+\/)?([a-p]{32})/;

  function extId() {
    const m = location.pathname.match(ID_RE);
    return m ? m[1] : '';
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

  function addButton() {
    const id = extId();
    if (!id || document.getElementById('tron-install-btn')) return;
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
    btn.addEventListener('click', () => { window.location.href = crxUrl(id); });
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
