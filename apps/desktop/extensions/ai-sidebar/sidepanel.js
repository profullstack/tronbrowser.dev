import { PROVIDERS, chatStream } from './providers.js';

const el = (id) => document.getElementById(id);
const messagesEl = el('messages');
const inputEl = el('input');
const sendBtn = el('send');
const providerEl = el('provider');
const setupEl = el('setup');

/** Conversation history sent to the model. */
const history = [];
let config = null;

async function loadConfig() {
  const { aiConfig } = await chrome.storage.local.get('aiConfig');
  config = aiConfig || null;
  const ok = config && config.provider && (config.model) && (config.apiKey || PROVIDERS[config.provider]?.keyless);
  setupEl.classList.toggle('hidden', !!ok);
  sendBtn.disabled = !ok;
  providerEl.textContent = ok ? `${PROVIDERS[config.provider]?.label || config.provider} · ${config.model}` : '';
  return ok;
}

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

async function pageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return '';
    return `Current page: ${tab.title || ''} <${tab.url || ''}>`;
  } catch {
    return '';
  }
}

async function send(text) {
  if (!(await loadConfig())) return;

  const messages = [...history];
  if (el('use-page').checked) {
    const ctx = await pageContext();
    if (ctx) messages.unshift({ role: 'system', content: `You are TronBrowser's AI assistant. ${ctx}` });
  }
  messages.push({ role: 'user', content: text });
  history.push({ role: 'user', content: text });

  addMessage('user', text);
  const out = addMessage('assistant', '');
  sendBtn.disabled = true;

  try {
    const full = await chatStream(config, messages, (delta) => {
      out.textContent += delta;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
    history.push({ role: 'assistant', content: full });
  } catch (err) {
    out.classList.remove('assistant');
    out.classList.add('msg', 'error');
    out.textContent = `Error: ${err.message}`;
  } finally {
    sendBtn.disabled = false;
  }
}

el('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  send(text);
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    el('composer').requestSubmit();
  }
});

el('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
el('open-options').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
chrome.storage.onChanged.addListener((changes) => { if (changes.aiConfig) loadConfig(); });

loadConfig();
