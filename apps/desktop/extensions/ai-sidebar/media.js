import { BTR_BASE, getToken, connect, verify, disconnect } from './bittorrented.js';

const $ = (id) => document.getElementById(id);
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };

let activeTab = 'favorites';

function setStatus(text, kind) { const s = $('status'); s.textContent = text; s.className = 'status ' + (kind || ''); }

function showConnected(email) {
  $('connect').classList.remove('active');
  $('content').classList.add('active');
  $('acct').textContent = email || 'connected';
  $('disc').classList.remove('hidden');
  loadTab(activeTab);
}

function showDisconnected() {
  $('content').classList.remove('active');
  $('connect').classList.add('active');
  $('acct').textContent = '';
  $('disc').classList.add('hidden');
}

// bittorrented item shapes vary by section — render defensively from common fields.
function fieldOf(o, keys) { for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k]; return ''; }

function renderItems(items) {
  const list = $('list'); list.innerHTML = '';
  if (!Array.isArray(items) || items.length === 0) { list.appendChild(el('div', 'muted', 'Nothing here yet.')); return; }
  for (const it of items) {
    const title = fieldOf(it, ['title', 'name', 'label']) || '(untitled)';
    const url = fieldOf(it, ['url', 'stream', 'streamUrl', 'link', 'magnet', 'href']);
    const sub = fieldOf(it, ['group', 'category', 'genre', 'author', 'description']);
    const row = el('div', 'msg');
    const n = el('span', 'n', '▶');
    const a = url ? el('a', null, title) : el('span', null, title);
    if (url) { a.href = url; a.target = '_blank'; a.rel = 'noreferrer'; }
    row.append(n, a);
    if (sub) { const s = el('span', 't', '  ' + sub); row.append(s); }
    list.appendChild(row);
  }
}

async function loadTab(tab) {
  activeTab = tab;
  document.querySelectorAll('#media-tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const list = $('list'); list.innerHTML = ''; list.appendChild(el('div', 'muted', 'Loading…'));
  const token = await getToken();
  // Map UI tabs → bittorrented.com /api/v1 endpoints.
  const path = { favorites: 'favorites', livetv: 'livetv', radio: 'radio', podcasts: 'podcasts' }[tab] || 'favorites';
  try {
    const r = await fetch(`${BTR_BASE}/api/v1/${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (r.status === 401) { showDisconnected(); setStatus('Session expired — connect again.', 'err'); return; }
    const data = await r.json().catch(() => ([]));
    renderItems(Array.isArray(data) ? data : (data.items || data.results || data[path] || []));
  } catch (e) {
    list.innerHTML = '';
    list.appendChild(el('div', 'muted', 'Could not load ' + path + '. ' + ((e && e.message) || '')));
  }
}

document.querySelectorAll('#media-tabs .tab').forEach((b) => b.addEventListener('click', () => loadTab(b.dataset.tab)));

$('go').addEventListener('click', async () => {
  setStatus('Opening bittorrented.com… finish signing in & approving in the new tab.');
  try {
    const res = await connect();
    if (res.connected) { setStatus('Connected ✓', 'ok'); showConnected(res.email); }
    else setStatus('Connection not completed.', 'err');
  } catch (e) { setStatus((e && e.message) || 'connect failed', 'err'); }
});

$('disc').addEventListener('click', async () => { await disconnect(); showDisconnected(); });

// On load: if already connected, jump straight to content.
(async () => {
  const res = await verify();
  if (res.connected) showConnected(res.email);
})();
