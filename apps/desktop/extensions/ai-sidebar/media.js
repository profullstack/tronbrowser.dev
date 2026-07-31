import { BTR_BASE, getToken, connect, verify, disconnect } from './bittorrented.js';

const el = (id) => document.getElementById(id);
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function escAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function setStatus(t, k) { const s = el('status'); s.textContent = t; s.className = 'status ' + (k || ''); }

let tokenCache = '';

function showConnected(email) {
  el('connect').classList.remove('active');
  el('content').classList.add('active');
  el('acct').textContent = email || 'connected';
  el('disc').classList.remove('hidden');
  loadFavorites();
}
function showDisconnected() {
  el('content').classList.remove('active');
  el('connect').classList.add('active');
  el('acct').textContent = '';
  el('disc').classList.add('hidden');
}

// --- favorites (Live TV / Podcasts / Radio / Music / Books / Movies) ---------
async function loadFavorites() {
  const token = await getToken();
  tokenCache = token || '';
  el('btr').innerHTML = '<p class="muted">Loading favorites…</p>';
  let data;
  try {
    const r = await fetch(`${BTR_BASE}/api/v1/favorites`, { headers: { authorization: `Bearer ${token}` } });
    if (r.status === 401) { showDisconnected(); setStatus('Session expired — connect again.', 'err'); return; }
    if (!r.ok) { el('btr').innerHTML = `<p class="muted">Couldn’t load favorites (${r.status}).</p>`; return; }
    data = await r.json();
  } catch (e) { el('btr').innerHTML = `<p class="muted">Couldn’t load favorites. ${escapeHtml((e && e.message) || '')}</p>`; return; }

  const tv = data.tv || [], radio = data.radio || [], pods = data.podcasts || [], movies = data.movies || [];

  const tile = (player, url, img, ph, label, sub, played) =>
    `<a class="btr-item" data-label="${escAttr(String(label || '').toLowerCase())}" ${player ? `href="#" data-player="${escAttr(player)}"` : `href="${escAttr(url)}" target="_blank" rel="noreferrer"`}>` +
    (img ? `<img src="${escAttr(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<span class="btr-ph">${ph}</span>`) +
    (played ? '<span class="btr-played" title="Played">✓</span>' : '') +
    `<span class="btr-label">${escapeHtml(label)}</span>` +
    (sub ? `<span class="btr-sub">${escapeHtml(sub)}</span>` : '') + '</a>';
  const group = (title, items) => items.length
    ? `<div class="btr-group" data-group><h3>${title} <span class="btr-count">${items.length}</span></h3><div class="btr-items">${items.join('')}</div></div>` : '';

  if (!tv.length && !radio.length && !pods.length && !movies.length) {
    el('btr').innerHTML = '<p class="muted">Connected — add Live TV, radio, podcast or movie favorites on bittorrented.com and they’ll show up here.</p>';
    return;
  }
  const music = movies.filter((m) => m.contentType === 'music');
  const books = movies.filter((m) => m.contentType === 'book');
  const shows = movies.filter((m) => !['music', 'book'].includes(m.contentType));

  el('btr').innerHTML = '<div id="btr-groups">' +
    group('Live TV', tv.map((c) => tile(c.player, c.url, c.logo, '📺', c.name))) +
    group('Podcasts', pods.map((p) => {
      const ep = (p.episodes || [])[0];
      const played = !!(ep && ep.progress && ep.progress.completed);
      const sub = ep ? (played ? `✓ ${ep.title}` : `▶ ${ep.title}`) : 'no recent episodes';
      return tile(ep && ep.player, p.url, p.image, '🎙', p.title, sub, played);
    })) +
    group('Radio', radio.map((s) => tile(s.player, s.url, s.logo, '📻', s.name))) +
    group('Music', music.map((m) => tile(m.player, m.url, m.poster, '🎵', m.title))) +
    group('Books', books.map((m) => tile(m.player, m.url, m.poster, '📖', m.title))) +
    group('Movies & Shows', shows.map((m) => tile(m.player, m.url, m.poster, '🎬', m.title))) +
    '</div>';
}

// live filter
el('btr-filter').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
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

// --- player modal (bittorrented /api/player in a themed iframe) ---------------
function openPlayer(url) {
  const sep = url.includes('?') ? '&' : '?';
  const tk = tokenCache ? `&token=${encodeURIComponent(tokenCache)}` : '';
  const type = (url.match(/[?&]type=([^&]+)/) || [])[1] || '';
  const isAudio = ['audio', 'podcast', 'music', 'radio'].includes(type);
  el('player-modal').classList.toggle('audio', isAudio);
  el('player-frame').src = `${url}${sep}theme=dark&bg=${encodeURIComponent('#05070d')}&accent=${encodeURIComponent('#34e7ff')}${tk}&_=${Date.now()}`;
  el('player-modal').hidden = false;
}
function closePlayer() { el('player-modal').hidden = true; el('player-frame').src = 'about:blank'; }
el('btr').addEventListener('click', (e) => {
  const a = e.target.closest('[data-player]');
  if (a) { e.preventDefault(); openPlayer(a.getAttribute('data-player')); }
});
el('player-close').addEventListener('click', closePlayer);
el('player-modal').addEventListener('click', (e) => { if (e.target === el('player-modal') && !el('player-modal').classList.contains('audio')) closePlayer(); });

// --- connect / disconnect -----------------------------------------------------
el('go').addEventListener('click', async () => {
  setStatus('Opening bittorrented.com… finish signing in & approving in the new tab.');
  try {
    const res = await connect();
    if (res.connected) { setStatus('Connected ✓', 'ok'); showConnected(res.email); }
    else setStatus('Connection not completed.', 'err');
  } catch (e) { setStatus((e && e.message) || 'connect failed', 'err'); }
});
el('disc').addEventListener('click', async () => { await disconnect(); showDisconnected(); });

(async () => { const res = await verify(); if (res.connected) showConnected(res.email); })();
