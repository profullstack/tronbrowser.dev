import { loadFeeds, parseFeed } from './feeds.js';
import { coinpaySignIn, coinpayState, coinpaySignOut } from './coinpay-auth.js';
import { fetchQuotes, fetchAllScores } from './markets.js';
import { fetchMotd } from './motd.js';
import { getToken as btrToken, BTR_BASE } from './bittorrented.js';

const el = (id) => document.getElementById(id);

// Defaults — the user can change these in Settings.
const DEFAULT_TICKERS = 'SPY, AAPL, NVDA, BTC-USD';
const DEFAULT_LEAGUES = 'nfl, nba';
const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

// --- Search: Web (NeoSearch by default) or AI (sidebar) ---
const SEARCH_ENGINES = {
  neosearch: { name: 'NeoSearch', url: 'https://neosearch.org/?q=' },
  xprivo: { name: 'Xprivo', url: 'https://www.xprivo.com/search/?q=' },
  ddg: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  // Altpower is a Google Programmable Search — query lives in the URL fragment.
  altpower: { name: 'Altpower', url: 'https://altpower.app/#open-source&gsc.tab=0&gsc.q=', suffix: '&gsc.sort=' },
  oxiverse: { name: 'Oxiverse', url: 'https://search.oxiverse.com/?q=', suffix: '&tab=web' },
};
// Tor-network search engines — used automatically when the 🧅 toggle is on
// (torEnabled in chrome.storage.local, set by background.js). Ahmia is the
// default: ahmia.fi is a stable clearnet domain reachable over the Tor SOCKS
// proxy that still indexes/returns .onion results, so it keeps working even
// when the onion-only mirrors rotate their addresses. The .onion URLs below
// resolve inside the SOCKS proxy (Chromium does DNS at the proxy for .onion).
// NOTE: onion addresses drift over time — verify against each engine's current
// mirror if a result page stops loading.
const TOR_SEARCH_ENGINES = {
  ahmia: { name: 'Ahmia', url: 'https://ahmia.fi/search/?q=' },
  torch: { name: 'Torch', url: 'http://torchdeedp3i2jigzjdmfpn5ttjhthh5wbmda2rr3jvqjg5p77c54dqd.onion/search?query=' },
  haystak: { name: 'Haystak', url: 'http://haystak5njsmn2hqkewecpaxetahtwhsbsa64jom2k22z5afxhnpxfid.onion/?q=' },
  onionland: { name: 'OnionLand', url: 'http://3bbad7fauom4d6sgppalyqddsqbf5u5p56b5k5uk2zxsy3d6ey2jobad.onion/search?q=' },
  excavator: { name: 'Excavator', url: 'http://2fd6cemt4gmccflhm6imvdfvli3nf7zn6rfrwpsy7uhxrgbypvwf5fad.onion/?q=' },
};
let searchMode = 'web';
let searchEngine = 'neosearch';
let torSearchEngine = 'ahmia';
let torEnabled = false;

// Resolve the engine to use right now: the Tor default while the onion toggle
// is on, otherwise the clearnet default.
function activeEngine() {
  if (torEnabled) return TOR_SEARCH_ENGINES[torSearchEngine] || TOR_SEARCH_ENGINES.ahmia;
  return SEARCH_ENGINES[searchEngine] || SEARCH_ENGINES.neosearch;
}

function setMode(mode) {
  searchMode = mode;
  el('mode-web').classList.toggle('active', mode === 'web');
  el('mode-ai').classList.toggle('active', mode === 'ai');
  el('mode-web').setAttribute('aria-selected', mode === 'web');
  el('mode-ai').setAttribute('aria-selected', mode === 'ai');
  const eng = activeEngine();
  el('q').placeholder = mode === 'ai' ? 'Ask AI anything…' : `Search ${eng.name}…`;
  el('q').focus();
}
el('mode-web').addEventListener('click', () => setMode('web'));
el('mode-ai').addEventListener('click', () => setMode('ai'));

// Load the chosen clearnet + Tor search engines and current onion-toggle state.
chrome.storage.local.get(['searchEngine', 'torSearchEngine', 'torEnabled']).then((v) => {
  if (v.searchEngine && SEARCH_ENGINES[v.searchEngine]) searchEngine = v.searchEngine;
  if (v.torSearchEngine && TOR_SEARCH_ENGINES[v.torSearchEngine]) torSearchEngine = v.torSearchEngine;
  torEnabled = !!v.torEnabled;
  if (searchMode === 'web') setMode('web');
});

// Keep the active engine in sync if the 🧅 toggle flips while the tab is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('torEnabled' in changes) torEnabled = !!changes.torEnabled.newValue;
  if ('torSearchEngine' in changes && TOR_SEARCH_ENGINES[changes.torSearchEngine.newValue]) {
    torSearchEngine = changes.torSearchEngine.newValue;
  }
  if ('searchEngine' in changes && SEARCH_ENGINES[changes.searchEngine.newValue]) {
    searchEngine = changes.searchEngine.newValue;
  }
  if (searchMode === 'web') setMode('web');
});

el('search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = el('q').value.trim();
  if (!q) return;
  if (searchMode === 'ai') {
    // Hand the question to the AI sidebar (privacy-first; uses your provider/key).
    await chrome.storage.local.set({ pendingAiQuery: { text: q, at: Date.now() } });
    chrome.runtime.sendMessage({ type: 'open-sidepanel' });
    el('q').value = '';
  } else {
    const eng = activeEngine();
    location.href = eng.url + encodeURIComponent(q) + (eng.suffix || '');
  }
});

// --- Links ---
el('ai').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.sendMessage({ type: 'open-sidepanel' }); });
el('settings').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
el('edit-feeds').addEventListener('click', () => chrome.runtime.openOptionsPage());
el('edit-markets').addEventListener('click', () => chrome.runtime.openOptionsPage());
el('edit-sports').addEventListener('click', () => chrome.runtime.openOptionsPage());

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
  // Per-feed timeout — without it, one dead/slow feed hangs Promise.all and the
  // whole grid is stuck on "Loading feeds…" forever.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(feed.xmlUrl, { redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const items = parseFeed(await res.text()).slice(0, 6);
    return { ...feed, items };
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'timed out' : e.message);
  } finally {
    clearTimeout(t);
  }
}

const CACHE_V = 3; // bump to invalidate caches when item shape changes / clear stale
async function getFeedData(feeds) {
  const { feedCache } = await chrome.storage.local.get('feedCache');
  if (feedCache && feedCache.v === CACHE_V && Date.now() - feedCache.at < TTL && feedCache.count === feeds.length) {
    return feedCache.data;
  }
  const data = await Promise.all(feeds.map(async (f) => {
    try { return await fetchFeed(f); }
    catch (e) { return { ...f, items: [], error: e.message }; }
  }));
  await chrome.storage.local.set({ feedCache: { v: CACHE_V, at: Date.now(), count: feeds.length, data } });
  return data;
}

function fmtDate(d) {
  const t = Date.parse(d);
  return isNaN(t) ? '' : new Date(t).toLocaleDateString();
}

async function renderFeeds() {
  const grid = el('feeds');
  let feeds, data;
  try {
    feeds = await loadFeeds();
    data = await getFeedData(feeds);
  } catch (e) {
    grid.innerHTML = `<p class="err">Couldn't load feeds: ${escapeHtml(e.message)}</p>`;
    return;
  }
  grid.innerHTML = '';
  for (const f of data) {
    const card = document.createElement('div');
    card.className = 'feedcard';
    const items = (f.items || []).map((it) => {
      const thumb = it.image
        ? `<img class="thumb" src="${escAttr(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
        : '';
      return `<li class="${it.image ? 'has-thumb' : ''}">${thumb}` +
        `<span class="it"><a href="${escAttr(it.link)}">${escapeHtml(it.title)}</a> ` +
        `<span class="date">${fmtDate(it.date)}</span></span></li>`;
    }).join('');
    card.innerHTML =
      `<h3><a href="${escAttr(f.htmlUrl)}">${escapeHtml(f.title)}</a></h3>` +
      (f.error ? `<div class="err">${escapeHtml(f.error)}</div>` : `<ul>${items || '<li class="muted">no items</li>'}</ul>`);
    grid.appendChild(card);
  }
}

// Hide thumbnails that fail to load (error doesn't bubble → capture phase).
el('feeds').addEventListener('error', (e) => {
  const t = e.target;
  if (t && t.classList && t.classList.contains('thumb')) {
    const li = t.closest('li'); if (li) li.classList.remove('has-thumb');
    t.remove();
  }
}, true);

function escapeHtml(s) {
  const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML;
}
function escAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Markets (stocks/crypto) + Sports — keyless, cached 5 min ---
const MKT_TTL = 5 * 60 * 1000;

async function renderMarkets() {
  const { tickers } = await chrome.storage.local.get('tickers');
  const symbols = splitList(tickers ?? DEFAULT_TICKERS);
  const sec = el('markets-sec');
  if (!symbols.length) { sec.hidden = true; return; }
  sec.hidden = false;

  const sig = symbols.join(',');
  const { marketCache } = await chrome.storage.local.get('marketCache');
  let data;
  if (marketCache && marketCache.sig === sig && Date.now() - marketCache.at < MKT_TTL) {
    data = marketCache.data;
  } else {
    data = await fetchQuotes(symbols);
    await chrome.storage.local.set({ marketCache: { at: Date.now(), sig, data } });
  }

  el('markets').innerHTML = data.map((q) => {
    if (q.error) return `<span class="tk err"><b>${escapeHtml(q.symbol)}</b> —</span>`;
    const pct = q.changePct;
    const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
    const sign = pct > 0 ? '+' : '';
    const price = q.price >= 1000 ? q.price.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : q.price.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return `<span class="tk"><b>${escapeHtml(q.symbol)}</b> ${price} ` +
      `<i class="${cls}">${sign}${pct.toFixed(2)}%</i></span>`;
  }).join('');
}

async function renderSports() {
  const { leagues } = await chrome.storage.local.get('leagues');
  const keys = splitList(leagues ?? DEFAULT_LEAGUES).map((k) => k.toLowerCase());
  const sec = el('sports-sec');
  if (!keys.length) { sec.hidden = true; return; }
  sec.hidden = false;

  const sig = keys.join(',');
  const { sportsCache } = await chrome.storage.local.get('sportsCache');
  let data;
  if (sportsCache && sportsCache.sig === sig && Date.now() - sportsCache.at < MKT_TTL) {
    data = sportsCache.data;
  } else {
    data = await fetchAllScores(keys);
    await chrome.storage.local.set({ sportsCache: { at: Date.now(), sig, data } });
  }

  el('sports').innerHTML = data.map((lg) => {
    const games = (lg.games || []).map((g) => {
      const a = g.away, h = g.home;
      if (g.state === 'pre' || !a?.score) {
        return `<li><span class="g">${escapeHtml(g.name)}</span><span class="when">${escapeHtml(g.detail || '')}</span></li>`;
      }
      const final = g.state === 'post';
      return `<li><span class="g">${escapeHtml(a?.abbr || '')} <b>${escapeHtml(String(a?.score ?? ''))}</b> @ ` +
        `${escapeHtml(h?.abbr || '')} <b>${escapeHtml(String(h?.score ?? ''))}</b></span>` +
        `<span class="when ${final ? 'final' : 'live'}">${escapeHtml(g.detail || '')}</span></li>`;
    }).join('');
    return `<div class="lgcard"><h3>${escapeHtml(lg.league.toUpperCase())}</h3>` +
      (lg.error ? `<div class="err">${escapeHtml(lg.error)}</div>`
        : `<ul>${games || '<li class="muted">no games</li>'}</ul>`) + `</div>`;
  }).join('');
}

// --- Message of the Day (profullstack.com/motd, cached 30 min) ---
async function renderMotd() {
  const sec = el('motd-sec');
  try {
    const text = await fetchMotd();
    if (!text) { sec.hidden = true; return; }
    // Preserve line breaks via CSS (.motd-body is pre-wrap); linkify URLs.
    el('motd').innerHTML = escapeHtml(text).replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noreferrer">$1</a>'
    );
    sec.hidden = false;
  } catch {
    sec.hidden = true;
  }
}

// --- bittorrented favorites (Live TV + Podcasts) when connected ---
let btrTokenCache = '';
async function renderBtr() {
  const sec = el('btr-sec');
  const token = await btrToken();
  btrTokenCache = token || '';
  if (!token) { sec.hidden = true; return; }
  let data;
  try {
    const r = await fetch(`${BTR_BASE}/api/v1/favorites`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) { sec.hidden = true; return; }
    data = await r.json();
  } catch { sec.hidden = true; return; }

  const tv = data.tv || [], radio = data.radio || [], pods = data.podcasts || [], movies = data.movies || [];
  sec.hidden = false;

  // Playable tiles carry data-player (open in a modal); the rest link out.
  // data-label drives the live filter below. ✓ marks already-played items.
  const tile = (player, url, img, ph, label, sub, played) =>
    `<a class="btr-item" data-label="${escAttr(String(label || '').toLowerCase())}" ${player ? `href="#" data-player="${escAttr(player)}"` : `href="${escAttr(url)}" target="_blank"`}>` +
    (img ? `<img src="${escAttr(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<span class="btr-ph">${ph}</span>`) +
    (played ? '<span class="btr-played" title="Played">✓</span>' : '') +
    `<span class="btr-label">${escapeHtml(label)}</span>` +
    (sub ? `<span class="btr-sub">${escapeHtml(sub)}</span>` : '') + `</a>`;
  const group = (title, items) => items.length
    ? `<div class="btr-group" data-group><h3>${title} <span class="btr-count">${items.length}</span></h3><div class="btr-items">${items.join('')}</div></div>` : '';

  if (!tv.length && !radio.length && !pods.length && !movies.length) {
    el('btr').innerHTML = '<p class="muted">Connected — add Live TV, radio, podcast or movie favorites on bittorrented.com and they’ll show up here.</p>';
    return;
  }
  const music = movies.filter((m) => m.contentType === 'music');
  const books = movies.filter((m) => m.contentType === 'book');
  const shows = movies.filter((m) => !['music', 'book'].includes(m.contentType));
  // Full list (no caps) + a live client-side filter across every section.
  el('btr').innerHTML =
    `<input id="btr-filter" class="btr-filter" type="search" placeholder="Filter favorites…" autocomplete="off" />` +
    `<div id="btr-groups">` +
    group('Live TV', tv.map((c) => tile(c.player, c.url, c.logo, '📺', c.name))) +
    group('Podcasts', pods.map((p) => {
      const ep = (p.episodes || [])[0];
      const played = !!(ep && ep.progress && ep.progress.completed);
      const sub = ep ? (played ? `✓ ${ep.title}` : `▶ ${ep.title}`) : 'no recent episodes';
      return tile(ep?.player, p.url, p.image, '🎙', p.title, sub, played);
    })) +
    group('Radio', radio.map((s) => tile(s.player, s.url, s.logo, '📻', s.name))) +
    group('Music', music.map((m) => tile(m.player, m.url, m.poster, '🎵', m.title))) +
    group('Books', books.map((m) => tile(m.player, m.url, m.poster, '📖', m.title))) +
    group('Movies & Shows', shows.map((m) => tile(m.player, m.url, m.poster, '🎬', m.title))) +
    `</div>`;

  const fi = el('btr-filter');
  if (fi) fi.addEventListener('input', () => {
    const q = fi.value.trim().toLowerCase();
    document.querySelectorAll('#btr-groups [data-group]').forEach((g) => {
      let any = false;
      g.querySelectorAll('.btr-item').forEach((it) => {
        const show = !q || (it.getAttribute('data-label') || '').includes(q);
        it.style.display = show ? '' : 'none';
        if (show) any = true;
      });
      g.style.display = any ? '' : 'none';
    });
  });
}

// Open a bittorrented /api/player URL in a themed modal iframe. Append the
// connect token so gated streams (Live TV) authenticate inside the iframe.
function openPlayer(url) {
  const sep = url.includes('?') ? '&' : '?';
  const tk = btrTokenCache ? `&token=${encodeURIComponent(btrTokenCache)}` : '';
  // Audio types (podcast/music/radio) render a docked bar, not a 16:9 video box —
  // size the modal as a short bottom dock to match.
  const type = (url.match(/[?&]type=([^&]+)/) || [])[1] || '';
  const isAudio = ['audio', 'podcast', 'music', 'radio'].includes(type);
  el('player-modal').classList.toggle('audio', isAudio);
  // _ cache-buster: never reuse a previously-cached response (older builds got an
  // X-Frame-Options header that the browser may still be holding).
  el('player-frame').src =
    `${url}${sep}theme=dark&bg=${encodeURIComponent('#05070d')}&accent=${encodeURIComponent('#34e7ff')}${tk}&_=${Date.now()}`;
  el('player-modal').hidden = false;
}
function closePlayer() { el('player-modal').hidden = true; el('player-frame').src = 'about:blank'; }
el('btr').addEventListener('click', (e) => {
  const a = e.target.closest('[data-player]');
  if (a) { e.preventDefault(); openPlayer(a.getAttribute('data-player')); }
});
el('player-close').addEventListener('click', closePlayer);
// Backdrop click closes video/TV, but NOT the docked audio bar — that stays put
// (like a now-playing bar) while you keep browsing. Use ✕ or Esc to dismiss it.
el('player-modal').addEventListener('click', (e) => {
  if (e.target === el('player-modal') && !el('player-modal').classList.contains('audio')) closePlayer();
});
// The player iframe has its own ✕ button; it asks the parent to close via postMessage.
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'tron-player-close') closePlayer();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePlayer(); });

renderMotd();
renderBtr();
renderFeeds();
renderMarkets();
renderSports();
