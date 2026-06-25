import { PROVIDERS } from './providers.js';
import { DEFAULT_FEEDS, parseOpml, toOpml, loadFeeds, saveFeeds } from './feeds.js';
import { coinpaySignIn, coinpayState, coinpaySignOut } from './coinpay-auth.js';
import { pushSettings, pullSettings } from './settings-store.js';

const el = (id) => document.getElementById(id);

/* ---------- AI providers ---------- */
const providerSel = el('provider');
for (const [id, meta] of Object.entries(PROVIDERS)) {
  const o = document.createElement('option');
  o.value = id; o.textContent = meta.label; providerSel.appendChild(o);
}
function updateKeyHint() {
  const meta = PROVIDERS[providerSel.value];
  el('keyhint').textContent = meta?.keyless ? 'Local provider — no API key needed.' : 'Required for this provider.';
  el('apiKey').disabled = !!meta?.keyless;
}
providerSel.addEventListener('change', updateKeyHint);

el('saveAi').addEventListener('click', async () => {
  const aiConfig = {
    provider: providerSel.value,
    model: el('model').value.trim(),
    apiKey: el('apiKey').value.trim(),
    baseUrl: el('baseUrl').value.trim(),
  };
  await chrome.storage.local.set({ aiConfig });
  await pushSettings();
  flash('savedAi', 'saved ✓');
});

/* ---------- CoinPay account + sync ---------- */
async function renderAccount() {
  const st = await coinpayState();
  el('account').textContent = st.signedIn
    ? `Signed in with CoinPay${st.label ? ' (' + st.label + ')' : ''} — settings sync to the cloud.`
    : 'Not signed in. (Settings stay on this device until you sign in.)';
  el('coinpay').textContent = st.signedIn ? 'Sign out' : 'Sign in with CoinPay';
}
el('coinpay').addEventListener('click', async () => {
  const st = await coinpayState();
  if (st.signedIn) { await coinpaySignOut(); }
  else {
    try { await coinpaySignIn(); await pullSettings(); await loadAll(); }
    catch (e) { el('account').textContent = 'Sign-in failed: ' + e.message; return; }
  }
  renderAccount();
});

/* ---------- Feeds ---------- */
async function renderFeeds() {
  const feeds = await loadFeeds();
  const list = el('feedlist');
  list.innerHTML = '';
  feeds.forEach((f, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span><b>${escape(f.title)}</b> <span class="cat">${escape(f.category || '')}</span><br><span class="cat">${escape(f.xmlUrl)}</span></span>`;
    const x = document.createElement('button');
    x.className = 'x'; x.textContent = '✕'; x.title = 'Remove';
    x.addEventListener('click', async () => { feeds.splice(i, 1); await persistFeeds(feeds); });
    li.appendChild(x);
    list.appendChild(li);
  });
}
async function persistFeeds(feeds) {
  await saveFeeds(feeds);
  await chrome.storage.local.remove('feedCache');
  await pushSettings();
  await renderFeeds();
}
el('addFeed').addEventListener('click', async () => {
  const url = el('fUrl').value.trim();
  if (!url) return flash('feedMsg', 'URL required');
  const feeds = await loadFeeds();
  feeds.push({ title: el('fTitle').value.trim() || url, category: el('fCat').value.trim() || 'Feeds', xmlUrl: url, htmlUrl: url });
  el('fTitle').value = el('fCat').value = el('fUrl').value = '';
  await persistFeeds(feeds);
  flash('feedMsg', 'added ✓');
});
el('importOpml').addEventListener('click', async () => {
  let xml = el('opmlText').value.trim();
  const file = el('opmlFile').files[0];
  if (!xml && file) xml = await file.text();
  if (!xml) return flash('feedMsg', 'paste OPML or pick a file');
  const parsed = parseOpml(xml);
  if (!parsed.length) return flash('feedMsg', 'no feeds found in OPML');
  await persistFeeds(parsed);
  el('opmlText').value = '';
  flash('feedMsg', `imported ${parsed.length} feeds ✓`);
});
el('exportOpml').addEventListener('click', async () => {
  const opml = toOpml(await loadFeeds());
  const url = URL.createObjectURL(new Blob([opml], { type: 'text/xml' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'tronbrowser-feeds.opml'; a.click();
  URL.revokeObjectURL(url);
});
el('resetFeeds').addEventListener('click', async () => { await persistFeeds(DEFAULT_FEEDS.slice()); flash('feedMsg', 'reset ✓'); });

/* ---------- load ---------- */
async function loadAll() {
  const { aiConfig, coinpayConfig, syncConfig } = await chrome.storage.local.get(['aiConfig', 'coinpayConfig', 'syncConfig']);
  if (aiConfig) {
    providerSel.value = aiConfig.provider || 'anthropic';
    el('model').value = aiConfig.model || '';
    el('apiKey').value = aiConfig.apiKey || '';
    el('baseUrl').value = aiConfig.baseUrl || '';
  }
  el('cpClient').value = coinpayConfig?.clientId || '';
  el('syncUrl').value = syncConfig?.url || '';
  updateKeyHint();
  await renderAccount();
  await renderFeeds();
}
el('cpClient').addEventListener('change', async () => {
  await chrome.storage.local.set({ coinpayConfig: { ...(await get('coinpayConfig')), clientId: el('cpClient').value.trim() } });
});
el('syncUrl').addEventListener('change', async () => {
  await chrome.storage.local.set({ syncConfig: { url: el('syncUrl').value.trim() } });
});
async function get(k) { return (await chrome.storage.local.get(k))[k] || {}; }

function flash(id, msg) { el(id).textContent = msg; setTimeout(() => (el(id).textContent = ''), 1600); }
function escape(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

loadAll();
