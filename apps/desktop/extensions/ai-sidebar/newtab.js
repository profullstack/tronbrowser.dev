import { loadFeeds, parseFeed } from './feeds.js';
import { coinpaySignIn, coinpayState, coinpaySignOut } from './coinpay-auth.js';

const el = (id) => document.getElementById(id);

// --- DuckDuckGo search (default; no Google) ---
el('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = el('q').value.trim();
  if (q) location.href = 'https://duckduckgo.com/?q=' + encodeURIComponent(q);
});

// --- Links ---
el('ai').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.sendMessage({ type: 'open-sidepanel' }); });
el('settings').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
el('edit-feeds').addEventListener('click', () => chrome.runtime.openOptionsPage());

// --- CoinPay sign-in ---
async function renderAccount() {
  const st = await coinpayState();
  if (st.signedIn) {
    el('account').textContent = st.label ? `CoinPay: ${st.label}` : 'Signed in with CoinPay';
    el('signin').textContent = 'Sign out';
    el('signin').classList.add('out');
    el('signin').onclick = async () => { await coinpaySignOut(); renderAccount(); };
  } else {
    el('account').textContent = '';
    el('signin').textContent = 'Sign in with CoinPay';
    el('signin').classList.remove('out');
    el('signin').onclick = async () => {
      el('signin').textContent = 'Connecting…';
      try { await coinpaySignIn(); } catch (err) { el('account').textContent = 'Sign-in failed: ' + err.message; }
      renderAccount();
    };
  }
}
renderAccount();

// --- Feeds (cached 15 min in chrome.storage.local) ---
const TTL = 15 * 60 * 1000;

async function fetchFeed(feed) {
  const res = await fetch(feed.xmlUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const items = parseFeed(await res.text()).slice(0, 6);
  return { ...feed, items };
}

async function getFeedData(feeds) {
  const { feedCache } = await chrome.storage.local.get('feedCache');
  if (feedCache && Date.now() - feedCache.at < TTL && feedCache.count === feeds.length) {
    return feedCache.data;
  }
  const data = await Promise.all(feeds.map(async (f) => {
    try { return await fetchFeed(f); }
    catch (e) { return { ...f, items: [], error: e.message }; }
  }));
  await chrome.storage.local.set({ feedCache: { at: Date.now(), count: feeds.length, data } });
  return data;
}

function fmtDate(d) {
  const t = Date.parse(d);
  return isNaN(t) ? '' : new Date(t).toLocaleDateString();
}

async function renderFeeds() {
  const feeds = await loadFeeds();
  const data = await getFeedData(feeds);
  const grid = el('feeds');
  grid.innerHTML = '';
  for (const f of data) {
    const card = document.createElement('div');
    card.className = 'feedcard';
    const items = (f.items || []).map((it) =>
      `<li><a href="${it.link}">${escapeHtml(it.title)}</a> <span class="date">${fmtDate(it.date)}</span></li>`
    ).join('');
    card.innerHTML =
      `<h3><a href="${f.htmlUrl}">${escapeHtml(f.title)}</a></h3>` +
      (f.error ? `<div class="err">${escapeHtml(f.error)}</div>` : `<ul>${items || '<li class="muted">no items</li>'}</ul>`);
    grid.appendChild(card);
  }
}

function escapeHtml(s) {
  const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML;
}

renderFeeds();
