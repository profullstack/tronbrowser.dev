// TronBrowser web settings — CRUD AI provider keys against the cloud account
// (/api/settings, synced to Turso). Requires a signed-in session (cookie).
// Keys are E2E-encrypted with a vault passphrase before they ever leave the
// browser; the server stores only ciphertext.
import { encryptVault, decryptVault } from './vault.js';
const $ = (id) => document.getElementById(id);

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

function buildProviderRows() {
  const sel = $('default');
  sel.innerHTML = '';
  const box = $('providers');
  box.innerHTML = '';
  const keys = settings.aiProviders || {};
  for (const p of PROVIDERS) {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.label; sel.appendChild(opt);

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
  sel.value = settings.aiDefault || 'anthropic';
  $('model').value = settings.aiModel || settings.aiConfig?.model || '';
  box.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', () => {
    const inp = box.querySelector(`[data-key="${b.getAttribute('data-reveal')}"]`);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.textContent = show ? 'hide' : 'show';
  }));
}

async function load() {
  if (!(await requireAuth())) return;
  settings = await api('/api/settings').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  // Decrypt the E2E vault into editable keys if present.
  if (settings.aiVault && !settings.aiProviders) {
    let pass = sessionStorage.getItem('tb_vault_pass') || prompt('Enter your vault passphrase to decrypt your AI keys:') || '';
    if (pass) {
      try { settings.aiProviders = await decryptVault(pass, settings.aiVault); sessionStorage.setItem('tb_vault_pass', pass); }
      catch { $('msg').textContent = 'wrong vault passphrase'; $('msg').className = 'err'; }
    }
  }
  buildProviderRows();
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
});

$('signout').addEventListener('click', async (e) => {
  e.preventDefault();
  await api('/api/auth/logout', { method: 'POST' });
  location.href = '/';
});

load();
