// TronBrowser web settings — CRUD AI provider keys against the cloud account
// (/api/settings, synced to Turso). Requires a signed-in session (cookie).
// Keys are E2E-encrypted with a vault passphrase before they ever leave the
// browser; the server stores only ciphertext.
import { encryptVault, decryptVault } from './vault.js';
import { mountSettingsSections } from './settings-sections.js';
const $ = (id) => document.getElementById(id);

// Persist the settings object to the cloud account (never plaintext keys).
async function persistSettings() {
  const { aiProviders: _a, aiConfig: _c, ...payload } = settings;
  const r = await fetch('/api/settings', {
    credentials: 'include', method: 'PUT',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  return r.ok;
}
// Store adapter for the shared Search/Markets/Sports/Feeds sections.
const cloudStore = {
  get: (keys) => { const o = {}; for (const k of keys) o[k] = settings[k]; return Promise.resolve(o); },
  set: async (obj) => { Object.assign(settings, obj); await persistSettings(); },
};
function flashMsg(id, msg) { const e = $(id); if (e) { e.textContent = msg; setTimeout(() => { e.textContent = ''; }, 1600); } }

const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic (Claude)', keyless: false },
  { id: 'openai', label: 'OpenAI', keyless: false },
  { id: 'google', label: 'Google (Gemini)', keyless: false },
  { id: 'deepseek', label: 'DeepSeek', keyless: false },
  { id: 'perplexity', label: 'Perplexity', keyless: false },
  { id: 'huggingface', label: 'Hugging Face', keyless: false },
  { id: 'kimi', label: 'Kimi (Moonshot)', keyless: false },
  { id: 'qwen', label: 'Qwen (Alibaba)', keyless: false },
  { id: 'ollama', label: 'Ollama (local)', keyless: true },
  { id: 'lmstudio', label: 'LM Studio (local)', keyless: true },
  { id: 'vllm', label: 'vLLM (self-hosted)', keyless: true },
];

// Common models per provider — shown immediately when you pick a provider, even
// before a key is entered. The live list (/api/models) is merged in on top when
// a key is available. You can always type a custom id.
const KNOWN_MODELS = {
  anthropic: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-fable-5'],
  openai: ['gpt-5.5', 'gpt-5', 'gpt-4.1', 'o4-mini', 'gpt-4o'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  perplexity: ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning'],
  huggingface: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct'],
  kimi: ['kimi-k2', 'kimi-latest', 'moonshot-v1-128k'],
  qwen: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
  ollama: ['llama3.2', 'qwen2.5', 'mistral', 'phi4'],
  lmstudio: [],
  vllm: [],
};

let settings = {};

async function api(path, opts = {}) {
  return fetch(path, { credentials: 'include', ...opts });
}

async function requireAuth() {
  const me = await api('/api/auth/me').then((r) => r.json()).catch(() => ({}));
  if (!me.signedIn) { location.href = '/login'; return null; }
  $('who').textContent = me.email || (me.id ? me.id.slice(0, 8) : 'signed in');
  return me;
}

// A provider counts as "configured" once it has a key (cloud) or base URL (local).
function isConfigured(p, cur) {
  return p.keyless ? !!(cur && cur.baseUrl) : !!(cur && cur.apiKey);
}

function buildProviderRows() {
  const sel = $('default');
  sel.innerHTML = '';
  const box = $('providers');
  box.innerHTML = '';
  const keys = settings.aiProviders || {};

  // Default-provider menu lists ONLY configured providers; fall back to all
  // when nothing is configured yet so the menu is never empty.
  const configured = PROVIDERS.filter((p) => isConfigured(p, keys[p.id]));
  const menu = configured.length ? configured : PROVIDERS;
  for (const p of menu) {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.label; sel.appendChild(opt);
  }

  // Key inputs still list every provider so you can add new keys.
  for (const p of PROVIDERS) {
    const cur = keys[p.id] || {};
    const val = (p.keyless ? (cur.baseUrl || '') : (cur.apiKey || '')).replace(/"/g, '&quot;');
    const row = document.createElement('div');
    row.className = 'grid';
    row.innerHTML =
      `<span class="lab">${p.label}</span>
       <input data-key="${p.id}" type="password"
         placeholder="${p.keyless ? 'base URL (optional, e.g. http://localhost:11434/v1)' : 'API key'}"
         value="${val}" />
       <button type="button" class="reveal" data-reveal="${p.id}">show</button>`;
    box.appendChild(row);
  }
  sel.value = menu.some((p) => p.id === settings.aiDefault) ? settings.aiDefault : (menu[0]?.id || 'anthropic');
  $('model').value = settings.aiModel || settings.aiConfig?.model || '';
  box.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', () => {
    const inp = box.querySelector(`[data-key="${b.getAttribute('data-reveal')}"]`);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.textContent = show ? 'hide' : 'show';
  }));
  fetchModels();
}

// Populate the model datalist for the selected provider. Always seeds known
// models immediately (no key needed); merges the live provider list on top when
// a key is present. Auto-fills a default model if the field is empty.
function setModelOptions(models) {
  const dl = $('modelList'); dl.innerHTML = '';
  const seen = new Set();
  for (const m of models) {
    if (!m || seen.has(m)) continue;
    seen.add(m);
    const o = document.createElement('option'); o.value = m; dl.appendChild(o);
  }
  // If nothing chosen yet, prefill the top option so the user isn't stuck.
  if (!$('model').value.trim() && models.length) $('model').value = models[0];
  return [...seen];
}

async function fetchModels() {
  const provider = $('default').value;
  const known = KNOWN_MODELS[provider] || [];
  const merged = setModelOptions(known);
  const meta = PROVIDERS.find((p) => p.id === provider) || {};
  if (meta.keyless) { $('modelHint').textContent = 'local provider — pick a common model or type your own'; return; }

  const keyInput = document.querySelector(`[data-key="${provider}"]`);
  const apiKey = keyInput ? keyInput.value.trim() : '';
  if (!apiKey) { $('modelHint').textContent = `${merged.length} common models — add your key above to load the full list`; return; }

  $('modelHint').textContent = 'loading models…';
  try {
    const r = await api('/api/models', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, apiKey }),
    });
    const d = await r.json();
    const live = (d.models || []);
    if (live.length) {
      const all = setModelOptions([...known, ...live]);
      $('modelHint').textContent = `${all.length} models — pick or type`;
    } else {
      $('modelHint').textContent = d.error ? `${merged.length} common models (live list: ${d.error})` : `${merged.length} common models`;
    }
  } catch {
    $('modelHint').textContent = `${merged.length} common models (couldn't reach provider)`;
  }
}
$('default').addEventListener('change', () => { $('model').value = ''; fetchModels(); });
$('providers').addEventListener('input', (e) => { if (e.target.matches(`[data-key="${$('default').value}"]`)) fetchModels(); });

// Masked passphrase prompt — native <dialog> (prompt() always shows plaintext).
function promptPassword(message) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'pw-dialog';
    dlg.innerHTML =
      `<form method="dialog">
         <p class="pw-msg"></p>
         <input type="password" autocomplete="current-password" spellcheck="false" />
         <menu>
           <button type="button" data-cancel>Cancel</button>
           <button value="ok" class="primary">Unlock</button>
         </menu>
       </form>`;
    dlg.querySelector('.pw-msg').textContent = message; // text node — no HTML injection
    const input = dlg.querySelector('input');
    dlg.querySelector('[data-cancel]').addEventListener('click', () => dlg.close(''));
    dlg.addEventListener('close', () => {
      const v = dlg.returnValue === 'ok' ? input.value : '';
      dlg.remove();
      resolve(v);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    input.focus();
  });
}

async function load() {
  if (!(await requireAuth())) return;
  settings = await api('/api/settings').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  // Decrypt the E2E vault into editable keys if present.
  if (settings.aiVault && !settings.aiProviders) {
    let pass = sessionStorage.getItem('tb_vault_pass') || await promptPassword('Enter your vault passphrase to decrypt your AI keys:') || '';
    if (pass) {
      try { settings.aiProviders = await decryptVault(pass, settings.aiVault); sessionStorage.setItem('tb_vault_pass', pass); }
      catch { $('msg').textContent = 'wrong vault passphrase'; $('msg').className = 'err'; }
    }
  }
  buildProviderRows();
  // Shared Search / Markets / Sports / RSS-feeds sections (same module the
  // extension options page uses) — read/write the same /api/settings object.
  await mountSettingsSections({ store: cloudStore, el: $, flash: flashMsg });
}

$('save').addEventListener('click', async () => {
  const aiProviders = {};
  document.querySelectorAll('[data-key]').forEach((inp) => {
    const id = inp.getAttribute('data-key');
    const p = PROVIDERS.find((x) => x.id === id);
    const v = inp.value.trim();
    if (!v) return;
    aiProviders[id] = p.keyless ? { baseUrl: v } : { apiKey: v };
  });
  const aiDefault = $('default').value;
  const model = $('model').value.trim();

  // E2E: encrypt keys with the vault passphrase; only ciphertext is stored.
  const pass = $('vault').value || sessionStorage.getItem('tb_vault_pass') || '';
  if (!pass) {
    $('msg').textContent = 'Set a vault passphrase to encrypt + save your keys.';
    $('msg').className = 'err';
    return;
  }
  sessionStorage.setItem('tb_vault_pass', pass);
  const aiVault = await encryptVault(pass, aiProviders);

  // Persist ONLY the encrypted vault + non-sensitive prefs (never plaintext keys).
  const { aiProviders: _drop, aiConfig: _drop2, ...rest } = settings;
  settings = { ...rest, aiVault, aiDefault, aiModel: model };
  const r = await api('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings),
  });
  $('msg').textContent = r.ok ? 'saved (encrypted) ✓' : 'save failed';
  $('msg').className = r.ok ? 'saved' : 'err';
  setTimeout(() => ($('msg').textContent = ''), 1800);

  // Refresh the view so the default-provider menu reflects the saved keys.
  if (r.ok) { settings.aiProviders = aiProviders; buildProviderRows(); }
});

$('signout').addEventListener('click', async (e) => {
  e.preventDefault();
  await api('/api/auth/logout', { method: 'POST' });
  location.href = '/';
});

load();
