import { PROVIDERS } from './providers.js';

const el = (id) => document.getElementById(id);
const providerSel = el('provider');

for (const [id, meta] of Object.entries(PROVIDERS)) {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = meta.label;
  providerSel.appendChild(opt);
}

function updateKeyHint() {
  const meta = PROVIDERS[providerSel.value];
  el('keyhint').textContent = meta?.keyless
    ? 'Local provider — no API key needed.'
    : 'Required for this provider.';
  el('apiKey').disabled = !!meta?.keyless;
}
providerSel.addEventListener('change', updateKeyHint);

async function load() {
  const { aiConfig } = await chrome.storage.local.get('aiConfig');
  if (aiConfig) {
    providerSel.value = aiConfig.provider || 'anthropic';
    el('model').value = aiConfig.model || '';
    el('apiKey').value = aiConfig.apiKey || '';
    el('baseUrl').value = aiConfig.baseUrl || '';
  }
  updateKeyHint();
}

el('save').addEventListener('click', async () => {
  const aiConfig = {
    provider: providerSel.value,
    model: el('model').value.trim(),
    apiKey: el('apiKey').value.trim(),
    baseUrl: el('baseUrl').value.trim(),
  };
  await chrome.storage.local.set({ aiConfig });
  el('saved').textContent = 'saved ✓';
  setTimeout(() => (el('saved').textContent = ''), 1500);
});

load();
