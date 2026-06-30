import { PROVIDERS, chatStream } from './providers.js';
import { renderMarkdown } from './markdown.js';

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

function scrollDown() { messagesEl.scrollTop = messagesEl.scrollHeight; }

// User messages are plain text (no markdown rendering of user input).
function addUserMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg user';
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollDown();
  return div;
}

// Assistant messages render markdown -> HTML and carry a "Copy markdown" button.
// Returns a handle: update(rawMarkdown) re-renders; finish() reveals actions.
function addAssistantMessage() {
  const div = document.createElement('div');
  div.className = 'msg assistant';
  const body = document.createElement('div');
  body.className = 'md';
  const actions = document.createElement('div');
  actions.className = 'actions hidden';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'copy-md';
  copy.textContent = 'Copy markdown';
  actions.appendChild(copy);
  div.append(body, actions);
  messagesEl.appendChild(div);
  scrollDown();

  let raw = '';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(raw);
      copy.textContent = 'Copied ✓';
      setTimeout(() => { copy.textContent = 'Copy markdown'; }, 1400);
    } catch {
      copy.textContent = 'Copy failed';
      setTimeout(() => { copy.textContent = 'Copy markdown'; }, 1400);
    }
  });

  return {
    el: div,
    update(text) { raw = text; body.innerHTML = renderMarkdown(text); scrollDown(); },
    finish() { if (raw.trim()) actions.classList.remove('hidden'); },
    error(msg) { div.className = 'msg error'; body.textContent = `Error: ${msg}`; },
  };
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

  addUserMessage(text);
  const out = addAssistantMessage();
  sendBtn.disabled = true;

  try {
    let acc = '';
    const full = await chatStream(config, messages, (delta) => {
      acc += delta;
      out.update(acc);
    });
    out.update(full || acc);
    out.finish();
    history.push({ role: 'assistant', content: full });
  } catch (err) {
    out.error(err.message);
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

// If the new-tab page (AI mode) queued a question, ask it on open.
async function consumePendingQuery() {
  const { pendingAiQuery } = await chrome.storage.local.get('pendingAiQuery');
  if (pendingAiQuery && pendingAiQuery.text) {
    await chrome.storage.local.remove('pendingAiQuery');
    if (await loadConfig()) send(pendingAiQuery.text);
    else setupEl.classList.remove('hidden');
  }
}

// --- Tor toggle ----------------------------------------------------------
// Flips the live session through Tor (background uses chrome.proxy). Convenience
// routing, not Tor-Browser-grade — see docs/tor-onion-mode.md.
const torBtn = el('tor');
const torStatusEl = el('tor-status');

function showTorStatus(kind, html) {
  torStatusEl.className = 'tor-status ' + kind;
  torStatusEl.innerHTML = html;
}
function hideTorStatus() {
  torStatusEl.className = 'tor-status hidden';
  torStatusEl.textContent = '';
}
function setTorButton(on) {
  torBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  torBtn.textContent = on ? '🧅 Tor ON' : '🧅 Tor';
}
// IPs come from check.torproject.org; still strip to IP chars before injecting.
function safeIp(ip) { return String(ip || '?').replace(/[^0-9a-fA-F.:]/g, ''); }

async function refreshTorState() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'tor-status' });
    setTorButton(!!(res && res.enabled));
  } catch (_) { /* background may be asleep */ }
}

async function toggleTor() {
  const turningOn = torBtn.getAttribute('aria-pressed') !== 'true';
  torBtn.classList.add('busy');
  torBtn.disabled = true;
  if (turningOn) showTorStatus('', 'Connecting through Tor…');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'tor-set', on: turningOn });
    const torBrowserNote =
      'Not Tor-Browser-grade — for real anonymity use ' +
      '<a href="https://www.torproject.org/" target="_blank" rel="noreferrer">Tor Browser</a>.';
    if (!turningOn) {
      setTorButton(false);
      hideTorStatus();
    } else if (res && res.enabled && res.check && res.check.ok && res.check.isTor) {
      setTorButton(true);
      showTorStatus('ok', `Connected via Tor · exit IP <code>${safeIp(res.check.ip)}</code>. ${torBrowserNote}`);
    } else if (res && res.enabled) {
      // Tor started and we're routing through it; the exit-IP probe just didn't
      // confirm in time (a fresh circuit can be slow). Stay ON, don't alarm.
      setTorButton(true);
      showTorStatus('ok', `Tor is on — routing this session through Tor. ${torBrowserNote}`);
    } else {
      // Background couldn't route. Explain why, in plain language.
      setTorButton(false);
      const err = res && res.started && res.started.error;
      if (err === 'tor-not-installed') {
        showTorStatus('warn', 'Tor isn’t installed on this computer yet, so it can’t be turned on here.');
      } else if (err === 'unreachable') {
        showTorStatus('warn', 'Couldn’t reach the Tor helper. Restart TronBrowser and try again, or run <code>tron tor</code>.');
      } else {
        showTorStatus('warn', 'Tor couldn’t start. Make sure Tor is installed, then try again.');
      }
    }
  } catch (e) {
    setTorButton(false);
    showTorStatus('warn', 'Could not toggle Tor: ' + ((e && e.message) || e));
  } finally {
    torBtn.classList.remove('busy');
    torBtn.disabled = false;
  }
}

torBtn.addEventListener('click', toggleTor);

(async () => { await loadConfig(); await consumePendingQuery(); await refreshTorState(); })();
