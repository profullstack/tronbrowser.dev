// Runs on https://tronbrowser.dev/ext-callback* — the landing page for both
// token-grant flows: the bittorrented.com "Connect" flow, and TronBrowser's own
// CoinPay sign-in (`?src=tb`). Reads the token from the URL and stores it under
// the key that flow waits on. We store DIRECTLY from the content script (content
// scripts can use chrome.storage with the "storage" permission) rather than
// messaging the background — an MV3 service worker can drop a message sent while
// it's waking up, which left the token unstored.
//
// This replaces chrome.identity.launchWebAuthFlow for both flows. Two separate
// reasons it can't be used: its chromiumapp.org callback is rewritten to a
// non-resolving .qjz9zk host by Ungoogled Chromium's domain substitution, and
// the API's safeRedirect() only honors same-origin redirect targets — so an
// off-origin chromiumapp.org callback was dropped server-side and only the
// WEBSITE ended up signed in.
(function () {
  try {
    const token =
      new URLSearchParams(location.hash.slice(1)).get('token') ||
      new URLSearchParams(location.search).get('token');
    if (!token || !chrome?.storage?.local) return;

    // `src=tb` -> TronBrowser session (CoinPay / ext-login); anything else is
    // the bittorrented.com connect flow, which predates the src marker.
    const key =
      new URLSearchParams(location.search).get('src') === 'tb'
        ? 'tbAuthToken'
        : 'btrToken';

    chrome.storage.local.set({ [key]: token });                  // store directly (reliable)
    chrome.runtime.sendMessage({ type: 'ext-token', key, token }); // also ask bg to close the tab
    history.replaceState(null, '', location.pathname);            // scrub the token from the URL

    const m = document.getElementById('msg');
    const s = document.getElementById('sub');
    if (m) m.textContent = 'Connected ✓';
    if (s) s.textContent = 'You can close this tab.';
  } catch (_) {
    /* not in the extension, or no token — leave the page as-is */
  }
})();
