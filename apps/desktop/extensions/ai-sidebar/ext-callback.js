// Runs on https://tronbrowser.dev/ext-callback* — the landing page of the
// bittorrented.com "Connect" flow. Reads the API token from the URL and stores
// it. We store DIRECTLY from the content script (content scripts can use
// chrome.storage with the "storage" permission) rather than messaging the
// background — an MV3 service worker can drop a message sent while it's waking
// up, which left the token unstored.
//
// This replaces chrome.identity.launchWebAuthFlow, whose chromiumapp.org
// callback is broken on Ungoogled Chromium (domain substitution -> .qjz9zk).
(function () {
  try {
    const token =
      new URLSearchParams(location.hash.slice(1)).get('token') ||
      new URLSearchParams(location.search).get('token');
    if (!token || !chrome?.storage?.local) return;

    chrome.storage.local.set({ btrToken: token });        // store directly (reliable)
    chrome.runtime.sendMessage({ type: 'btr-token', token }); // also ask bg to close the tab
    history.replaceState(null, '', location.pathname);     // scrub the token from the URL

    const m = document.getElementById('msg');
    const s = document.getElementById('sub');
    if (m) m.textContent = 'Connected ✓';
    if (s) s.textContent = 'You can close this tab.';
  } catch (_) {
    /* not in the extension, or no token — leave the page as-is */
  }
})();
