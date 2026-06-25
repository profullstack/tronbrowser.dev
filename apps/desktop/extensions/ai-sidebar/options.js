import { PROVIDERS, KNOWN_MODELS, listModels } from './providers.js';
import { DEFAULT_FEEDS, parseOpml, toOpml, loadFeeds, saveFeeds } from './feeds.js';
import { coinpaySignIn, coinpayState, coinpaySignOut } from './coinpay-auth.js';
import { pushSettings, pullSettings } from './settings-store.js';
import { encryptVault, decryptVault } from './vault.js';
import { connect as btrConnect, disconnect as btrDisconnect, verify as btrVerify } from './bittorrented.js';

const el = (id) => document.getElementById(id);
const PROV_LIST = Object.entries(PROVIDERS);

// A provider counts as "configured" once it has a key (cloud) or base URL (local).
function isConfigured(meta, cur) {
  return meta.keyless ? !!(cur && cur.baseUrl) : !!(cur && cur.apiKey);
}

/* ---------- AI providers (multiple, with reveal + E2E vault) ---------- */
function buildProviders(aiProviders, aiDefault) {
  const sel = el('default'); sel.innerHTML = '';
  const box = el('providers'); box.innerHTML = '';

  // Default-provider menu lists ONLY configured providers; fall back to all
  // when nothing is configured yet so the menu is never empty.
  const configured = PROV_LIST.filter(([id, meta]) => isConfigured(meta, aiProviders[id]));
  const menu = configured.length ? configured : PROV_LIST;
  for (const [id, meta] of menu) {
    const o = document.createElement('option'); o.value = id; o.textContent = meta.label; sel.appendChild(o);
  }

  // Key inputs still list every provider so you can add new keys.
  for (const [id, meta] of PROV_LIST) {
    const cur = aiProviders[id] || {};
    const val = meta.keyless ? (cur.baseUrl || '') : (cur.apiKey || '');
    const row = document.createElement('div'); row.className = 'prow';
    row.innerHTML =
      `<span class="plabel">${escape(meta.label)}</span>
       <input data-prov="${id}" type="password" placeholder="${meta.keyless ? 'base URL (optional)' : 'API key'}" value="${escape(val)}" />
       <button type="button" class="reveal" data-reveal="${id}">show</button>`;
    box.appendChild(row);
  }
  sel.value = (menu.find(([id]) => id === aiDefault) ? aiDefault : menu[0]?.[0]) || 'anthropic';
  box.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', () => {
    const inp = box.querySelector(`[data-prov="${b.getAttribute('data-reveal')}"]`);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.textContent = show ? 'hide' : 'show';
  }));
  fetchModels();
}

// Populate the model datalist for the selected provider: known models first
// (instant), then merge the provider's live list when a key is present.
function setModelOptions(models) {
  const dl = el('modelList'); dl.innerHTML = '';
  const seen = new Set();
  for (const m of models) {
    if (!m || seen.has(m)) continue;
    seen.add(m);
    const o = document.createElement('option'); o.value = m; dl.appendChild(o);
  }
  if (!el('model').value.trim() && seen.size) el('model').value = [...seen][0];
  return [...seen];
}

async function fetchModels() {
  const provider = el('default').value;
  const meta = PROVIDERS[provider];
  if (!meta) return;
  const known = KNOWN_MODELS[provider] || [];
  const merged = setModelOptions(known);

  const keyInput = el('providers').querySelector(`[data-prov="${provider}"]`);
  const val = keyInput ? keyInput.value.trim() : '';
  const cfg = meta.keyless ? { provider, baseUrl: val } : { provider, apiKey: val };
  if (!meta.keyless && !val) { el('modelHint').textContent = `${merged.length} common models — add your key above to load the full list`; return; }

  el('modelHint').textContent = 'loading models…';
  try {
    const live = await listModels(cfg);
    if (live.length) {
      const all = setModelOptions([...known, ...live]);
      el('modelHint').textContent = `${all.length} models — pick or type`;
    } else {
      el('modelHint').textContent = `${merged.length} common models`;
    }
  } catch (e) {
    el('modelHint').textContent = `${merged.length} common models (couldn't reach provider)`;
  }
}
el('default').addEventListener('change', () => { el('model').value = ''; fetchModels(); });
el('providers').addEventListener('input', (e) => { if (e.target.matches(`[data-prov="${el('default').value}"]`)) fetchModels(); });

function collectProviders() {
  const aiProviders = {};
  el('providers').querySelectorAll('[data-prov]').forEach((inp) => {
    const id = inp.getAttribute('data-prov'); const v = inp.value.trim();
    if (!v) return;
    aiProviders[id] = PROVIDERS[id].keyless ? { baseUrl: v } : { apiKey: v };
  });
  return aiProviders;
}

el('saveAi').addEventListener('click', async () => {
  const aiProviders = collectProviders();
  const aiDefault = el('default').value;
  const model = el('model').value.trim();
  const def = aiProviders[aiDefault] || {};
  // aiConfig is the active provider; stays LOCAL (never synced in plaintext).
  const aiConfig = { provider: aiDefault, model, apiKey: def.apiKey || '', baseUrl: def.baseUrl || '' };
  await chrome.storage.local.set({ aiProviders, aiDefault, aiModel: model, aiConfig });

  // E2E: with a vault passphrase, encrypt the keys so only ciphertext syncs.
  const pass = el('vault').value;
  if (pass) {
    await chrome.storage.local.set({ aiVault: await encryptVault(pass, aiProviders) });
    sessionStorage.setItem('tb_vault_pass', pass);
  } else {
    await chrome.storage.local.remove('aiVault');
  }
  await pushSettings();
  flash('savedAi', el('vault').value ? 'saved (encrypted) ✓' : 'saved ✓ — set a vault passphrase to sync keys');
  await loadAll(); // refresh so the default-provider menu reflects newly-added keys
});

/* ---------- bittorrented.com connect ---------- */
async function renderBtr() {
  const st = await btrVerify();
  if (st.connected) {
    el('btrAccount').textContent = `Connected${st.email ? ' as ' + st.email : ''} — your favorites sync to TronBrowser.`;
    el('btrConnect').textContent = 'Disconnect';
  } else {
    el('btrAccount').textContent = 'Not connected.';
    el('btrConnect').textContent = 'Connect bittorrented.com';
  }
}
el('btrConnect').addEventListener('click', async () => {
  const st = await btrVerify();
  if (st.connected) { await btrDisconnect(); await renderBtr(); return; }
  el('btrMsg').textContent = 'opening bittorrented.com…';
  try { await btrConnect(); el('btrMsg').textContent = 'connected ✓'; }
  catch (e) { el('btrMsg').textContent = 'connect failed: ' + e.message; }
  setTimeout(() => (el('btrMsg').textContent = ''), 2500);
  await renderBtr();
});

/* ---------- Markets & Sports (new-tab widgets) ---------- */
el('saveMarkets').addEventListener('click', async () => {
  const tickers = el('tickers').value.trim();
  const leagues = el('leagues').value.trim();
  await chrome.storage.local.set({ tickers, leagues });
  // Invalidate the new-tab caches so the change shows immediately.
  await chrome.storage.local.remove(['marketCache', 'sportsCache']);
  await pushSettings();
  flash('savedMarkets', 'saved ✓');
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
  const { aiProviders, aiDefault, aiModel, aiVault, coinpayConfig, syncConfig } =
    await chrome.storage.local.get(['aiProviders', 'aiDefault', 'aiModel', 'aiVault', 'coinpayConfig', 'syncConfig']);
  let provs = aiProviders || {};
  // Cross-device: only an encrypted vault present → decrypt with the passphrase.
  if (!Object.keys(provs).length && aiVault) {
    let pass = sessionStorage.getItem('tb_vault_pass');
    if (!pass) pass = prompt('Enter your TronBrowser vault passphrase to decrypt your AI keys:') || '';
    if (pass) {
      try { provs = (await decryptVault(pass, aiVault)) || {}; sessionStorage.setItem('tb_vault_pass', pass); }
      catch { provs = {}; flash('savedAi', 'wrong vault passphrase'); }
    }
  }
  el('model').value = aiModel || '';
  buildProviders(provs, aiDefault);
  el('cpClient').value = coinpayConfig?.clientId || '';
  el('syncUrl').value = syncConfig?.url || '';
  const mkt = await chrome.storage.local.get(['tickers', 'leagues']);
  el('tickers').value = mkt.tickers ?? '';
  el('leagues').value = mkt.leagues ?? '';
  await renderAccount();
  await renderFeeds();
  await renderBtr();
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
