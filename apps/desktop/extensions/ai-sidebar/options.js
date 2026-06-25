import { PROVIDERS } from './providers.js';
import { DEFAULT_FEEDS, parseOpml, toOpml, loadFeeds, saveFeeds } from './feeds.js';
import { coinpaySignIn, coinpayState, coinpaySignOut } from './coinpay-auth.js';
import { pushSettings, pullSettings } from './settings-store.js';
import { encryptVault, decryptVault } from './vault.js';

const el = (id) => document.getElementById(id);
const PROV_LIST = Object.entries(PROVIDERS);

/* ---------- AI providers (multiple, with reveal + E2E vault) ---------- */
function buildProviders(aiProviders, aiDefault) {
  const sel = el('default'); sel.innerHTML = '';
  const box = el('providers'); box.innerHTML = '';
  for (const [id, meta] of PROV_LIST) {
    const o = document.createElement('option'); o.value = id; o.textContent = meta.label; sel.appendChild(o);
    const cur = aiProviders[id] || {};
    const val = meta.keyless ? (cur.baseUrl || '') : (cur.apiKey || '');
    const row = document.createElement('div'); row.className = 'prow';
    row.innerHTML =
      `<span class="plabel">${escape(meta.label)}</span>
       <input data-prov="${id}" type="password" placeholder="${meta.keyless ? 'base URL (optional)' : 'API key'}" value="${escape(val)}" />
       <button type="button" class="reveal" data-reveal="${id}">show</button>`;
    box.appendChild(row);
  }
  sel.value = aiDefault || 'anthropic';
  box.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', () => {
    const inp = box.querySelector(`[data-prov="${b.getAttribute('data-reveal')}"]`);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.textContent = show ? 'hide' : 'show';
  }));
}

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
