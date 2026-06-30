// Interstitial shown while Tor connects to reach a .onion site. The background
// pushes `tor-progress` while bootstrapping, then navigates this tab to the
// onion once routed (or sends `onion-error` if it couldn't connect).
const params = new URLSearchParams(location.search);
const target = params.get('u') || '';
document.getElementById('url').textContent = target;

const fill = document.getElementById('fill');
const pct = document.getElementById('pct');

function setProgress(p) {
  const v = Math.max(5, Math.min(100, p));
  fill.style.width = v + '%';
  pct.textContent = Math.round(p) + '%';
}

function showError(msg) {
  const e = document.getElementById('err');
  e.textContent = msg;
  e.classList.remove('hidden');
  pct.textContent = '';
}

chrome.runtime.onMessage.addListener((m) => {
  if (!m) return;
  if (m.type === 'tor-progress') setProgress(m.pct);
  if (m.type === 'onion-error') {
    if (m.reason === 'tor-not-installed') {
      showError('Tor isn’t installed yet. Run `tron tor` once, then reload this page.');
    } else if (m.reason === 'unreachable') {
      showError('Couldn’t reach the Tor helper. Restart TronBrowser and try again.');
    } else {
      showError('Couldn’t connect to Tor. Try reloading this page in a moment.');
    }
  }
});
