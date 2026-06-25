// TronBrowser web settings — CRUD AI provider keys against the cloud account
// (/api/settings, synced to Turso). Requires a signed-in session (cookie).
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
    const row = document.createElement('div');
    row.className = 'grid';
    row.innerHTML =
      `<span class="lab">${p.label}</span>
       <input data-key="${p.id}" type="${p.keyless ? 'text' : 'password'}"
         placeholder="${p.keyless ? 'base URL (optional, e.g. http://localhost:11434/v1)' : 'API key'}"
         value="${(p.keyless ? (cur.baseUrl || '') : (cur.apiKey || '')).replace(/"/g, '&quot;')}" />
       <span></span>`;
    box.appendChild(row);
  }
  sel.value = settings.aiDefault || 'anthropic';
  $('model').value = settings.aiConfig?.model || '';
}

async function load() {
  if (!(await requireAuth())) return;
  settings = await api('/api/settings').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
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
  const def = aiProviders[aiDefault] || {};
  // aiConfig mirrors the chosen default for the extension/sidebar.
  const aiConfig = { provider: aiDefault, model, apiKey: def.apiKey || '', baseUrl: def.baseUrl || '' };

  settings = { ...settings, aiProviders, aiDefault, aiConfig };
  const r = await api('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings),
  });
  $('msg').textContent = r.ok ? 'saved ✓' : 'save failed';
  $('msg').className = r.ok ? 'saved' : 'err';
  setTimeout(() => ($('msg').textContent = ''), 1800);
});

$('signout').addEventListener('click', async (e) => {
  e.preventDefault();
  await api('/api/auth/logout', { method: 'POST' });
  location.href = '/';
});

load();
