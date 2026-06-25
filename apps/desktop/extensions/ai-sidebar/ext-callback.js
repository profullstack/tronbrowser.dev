// Runs on https://tronbrowser.dev/ext-callback* — the landing page of the
// bittorrented.com "Connect" flow. Reads the API token from the URL fragment
// (#token=…) and hands it to the extension, which stores it and closes the tab.
//
// This replaces chrome.identity.launchWebAuthFlow, whose chromiumapp.org
// callback is broken on Ungoogled Chromium (domain substitution rewrites it to
// a non-resolving .qjz9zk host, so the redirect can't be intercepted).
(function () {
  try {
    const token = new URLSearchParams(location.hash.slice(1)).get('token');
    if (token) {
      chrome.runtime.sendMessage({ type: 'btr-token', token });
      const m = document.getElementById('msg');
      const s = document.getElementById('sub');
      if (m) m.textContent = 'Connected ✓';
      if (s) s.textContent = 'You can close this tab.';
    }
  } catch (_) {
    /* not in the extension, or no token — leave the page as-is */
  }
})();
