import { IrcClient } from './irc.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// --- top tabs -------------------------------------------------------------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    const name = btn.dataset.tab;
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
    if (name === 'qrypt') {
      const f = document.getElementById('qrypt-frame'); // load the live app on first open
      if (f && !f.getAttribute('src')) f.setAttribute('src', 'https://qrypt.chat/');
    }
  });
});

// --- IRC ------------------------------------------------------------------
const STORE_KEY = 'ircConfig';
const irc = new IrcClient();
const buffers = new Map(); // channel -> [{from,text,time,...}]
let active = null;

function setStatus(text, kind) { const s = $('irc-status'); s.textContent = text; s.className = 'status ' + (kind || ''); }

function ensureBuffer(chan) {
  if (!buffers.has(chan)) { buffers.set(chan, []); renderChanList(); }
}

function renderChanList() {
  const ul = $('chan-list'); ul.innerHTML = '';
  for (const chan of buffers.keys()) {
    const li = el('li', chan === active ? 'active' : '', chan);
    li.addEventListener('click', () => selectChannel(chan));
    ul.appendChild(li);
  }
}

function selectChannel(chan) {
  active = chan;
  $('chan-title').textContent = chan;
  renderChanList();
  const m = $('msgs'); m.innerHTML = '';
  for (const line of buffers.get(chan) || []) appendMsg(line, false);
  m.scrollTop = m.scrollHeight;
  $('say-input').focus();
}

function appendMsg(line, store = true) {
  if (store) { ensureBuffer(line.channel); buffers.get(line.channel).push(line); }
  if (line.channel !== active) return;
  const m = $('msgs');
  const div = el('div', 'msg' + (line.sys ? ' sys' : '') + (line.self ? ' self' : '') + (line.notice ? ' notice' : ''));
  if (line.sys) {
    div.append(el('span', null, '— ' + line.text));
  } else {
    const t = new Date(line.time);
    div.append(el('span', 't', isNaN(t) ? '' : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
    div.append(el('span', 'n', (line.from || '') + ':'));
    div.append(el('span', null, line.text));
  }
  const atBottom = m.scrollHeight - m.scrollTop - m.clientHeight < 40;
  m.appendChild(div);
  if (atBottom) m.scrollTop = m.scrollHeight;
}

irc.addEventListener('status', (e) => {
  const { state, error } = e.detail;
  if (state === 'connecting') setStatus('Connecting…');
  else if (state === 'connected') {
    setStatus('Connected ✓', 'ok');
    $('irc-connect').classList.add('hidden');
    $('irc-client').classList.remove('hidden');
    $('irc-me').textContent = irc.nick;
  } else if (state === 'disconnected') {
    setStatus('Disconnected', 'err');
  } else if (state === 'error') {
    setStatus(error || 'error', 'err');
  }
});
irc.addEventListener('joined', (e) => { ensureBuffer(e.detail.channel); if (!active) selectChannel(e.detail.channel); });
irc.addEventListener('message', (e) => appendMsg(e.detail));
irc.addEventListener('system', (e) => { if (e.detail.channel) appendMsg({ channel: e.detail.channel, sys: true, text: e.detail.text }); });
irc.addEventListener('topic', (e) => { if (e.detail.channel === active) $('chan-title').textContent = `${e.detail.channel} — ${e.detail.topic}`; });

async function doConnect() {
  const cfg = {
    url: $('irc-url').value.trim(),
    nick: $('irc-nick').value.trim(),
    password: $('irc-pass').value,
    channels: $('irc-chans').value.split(/[,\s]+/).filter(Boolean),
  };
  if (!cfg.nick) { setStatus('Enter your BBS username', 'err'); return; }
  if (!cfg.password) { setStatus('Enter your IRC password (this network requires SASL login)', 'err'); return; }
  if ($('irc-remember').checked) {
    chrome.storage.local.set({ [STORE_KEY]: cfg });
  }
  irc.connect(cfg);
}

$('irc-go').addEventListener('click', doConnect);
$('irc-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doConnect(); });
$('irc-disc').addEventListener('click', () => { irc.quit(); $('irc-client').classList.add('hidden'); $('irc-connect').classList.remove('hidden'); });

$('join-form').addEventListener('submit', (e) => { e.preventDefault(); const v = $('join-input').value.trim(); if (v) { irc.join(v); $('join-input').value = ''; } });
$('say-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('say-input').value;
  if (!v.trim() || !active) return;
  if (v.startsWith('/join ')) irc.join(v.slice(6).trim());
  else if (v.startsWith('/msg ')) { const [, who, ...rest] = v.split(' '); irc.say(who, rest.join(' ')); }
  else irc.say(active, v);
  $('say-input').value = '';
});

// Prefill from saved config.
(async () => {
  const { [STORE_KEY]: cfg } = await chrome.storage.local.get(STORE_KEY);
  if (cfg) {
    $('irc-url').value = cfg.url || $('irc-url').value;
    $('irc-nick').value = cfg.nick || '';
    $('irc-pass').value = cfg.password || '';
    $('irc-chans').value = (cfg.channels || ['#general']).join(' ');
  }
})();
