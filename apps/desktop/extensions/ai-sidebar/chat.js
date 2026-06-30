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
    if (name === 'pair') {
      const f = document.getElementById('pair-frame'); // load PairUX on first open
      if (f && !f.getAttribute('src')) f.setAttribute('src', 'https://pairux.com/');
    }
  });
});

// CoinPay login can't render in the embed (OAuth provider refuses framing) →
// open qrypt.chat in a full tab where the top-level redirect works.
const qo = document.getElementById('qrypt-open');
if (qo) qo.addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: 'https://qrypt.chat/' }); });

// open pairux.com in a full tab (e.g. for screen-capture permission prompts).
const po = document.getElementById('pair-open');
if (po) po.addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: 'https://pairux.com/' }); });

// --- IRC ------------------------------------------------------------------
const STORE_KEY = 'ircConfig';
const STATUS = '✻ status'; // server/system window (always present, pinned first)
const irc = new IrcClient();
const buffers = new Map(); // channel -> [{from,text,time,...}]
let active = null;
const unread = new Set();   // channels/status with new activity since last viewed
const mentions = new Set(); // subset: a DM or a mention of our nick (stronger highlight)

function logStatus(text) { appendMsg({ channel: STATUS, sys: true, text, time: Date.now() }); }

function setStatus(text, kind) { const s = $('irc-status'); s.textContent = text; s.className = 'status ' + (kind || ''); }

function ensureBuffer(chan) {
  if (!buffers.has(chan)) { buffers.set(chan, []); renderChanList(); }
}

function renderChanList() {
  const ul = $('chan-list'); ul.innerHTML = '';
  for (const chan of buffers.keys()) {
    let cls = 'chan';
    if (chan === active) cls += ' active';
    else if (mentions.has(chan)) cls += ' unread mention';
    else if (unread.has(chan)) cls += ' unread';
    const li = el('li', cls);
    li.append(el('span', 'name', chan));
    if (chan !== active && (unread.has(chan) || mentions.has(chan))) li.append(el('span', 'dot'));
    li.addEventListener('click', () => selectChannel(chan));
    ul.appendChild(li);
  }
}

function selectChannel(chan) {
  active = chan;
  unread.delete(chan); mentions.delete(chan); // viewing it clears the highlight
  $('chan-title').textContent = chan;
  renderChanList();
  const m = $('msgs'); m.innerHTML = '';
  for (const line of buffers.get(chan) || []) appendMsg(line, false);
  m.scrollTop = m.scrollHeight;
  $('say-input').focus();
}

function appendMsg(line, store = true) {
  if (store) {
    ensureBuffer(line.channel);
    buffers.get(line.channel).push(line);
    if (line.channel && line.channel !== active) {
      unread.add(line.channel);
      if (!line.sys && (isDM(line) || isMention(line))) mentions.add(line.channel);
      renderChanList();
    }
  }
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
  if (state === 'connecting') { setStatus('Connecting…'); logStatus('Connecting…'); }
  else if (state === 'connected') {
    setStatus('Connected ✓', 'ok');
    $('irc-connect').classList.add('hidden');
    $('irc-client').classList.remove('hidden');
    $('irc-me').textContent = irc.nick;
    logStatus(`Connected as ${irc.nick}`);
  } else if (state === 'disconnected') {
    setStatus('Disconnected', 'err');
    logStatus('Disconnected');
  } else if (state === 'error') {
    setStatus(error || 'error', 'err');
    logStatus('Error: ' + (error || 'unknown'));
  }
});
irc.addEventListener('joined', (e) => { ensureBuffer(e.detail.channel); if (!active || active === STATUS) selectChannel(e.detail.channel); });
irc.addEventListener('message', (e) => { appendMsg(e.detail); maybeNotify(e.detail); });

// --- web notifications for incoming IRC messages --------------------------
const isDM = (line) => line.channel && !line.channel.startsWith('#');
const isMention = (line) =>
  irc.nick && line.text && line.text.toLowerCase().includes(irc.nick.toLowerCase());

function maybeNotify(line) {
  // Only real incoming chat — skip our own echo, system lines, and server notices.
  if (!line || line.self || line.sys || line.notice) return;
  // Don't nag for the channel the user is actively reading with the panel open.
  const unattended = document.hidden || line.channel !== active || isDM(line) || isMention(line);
  if (!unattended) return;
  if (!chrome?.notifications?.create) return;
  const dm = isDM(line);
  chrome.notifications.create('irc:' + line.channel, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: dm ? `IRC · ${line.from} (DM)` : `IRC · ${line.channel}`,
    message: `${dm ? '' : line.from + ': '}${line.text}`.slice(0, 240),
    priority: dm || isMention(line) ? 2 : 0,
  });
}

// Clicking a notification focuses the channel it came from.
if (chrome?.notifications?.onClicked) {
  chrome.notifications.onClicked.addListener((id) => {
    if (id.startsWith('irc:')) {
      const chan = id.slice(4);
      if (buffers.has(chan)) selectChannel(chan);
      chrome.notifications.clear(id);
    }
  });
}
irc.addEventListener('system', (e) => { appendMsg({ channel: e.detail.channel || STATUS, sys: true, text: e.detail.text }); });
irc.addEventListener('names', (e) => logStatus(`Names ${e.detail.channel}: ${(e.detail.names || []).join(' ')}`));
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
  if (!v.trim()) return;
  if (v[0] === '/') handleCommand(v.slice(1));
  else if (active && active !== STATUS) irc.say(active, v);
  else logStatus('Not in a channel — use /join #channel');
  $('say-input').value = '';
});

// Slash-commands → real IRC. Known verbs get friendly handling; anything else
// is passed through verbatim (e.g. "/mode #chan +o nick", "/who #chan").
function handleCommand(raw) {
  const sp = raw.indexOf(' ');
  const cmd = (sp === -1 ? raw : raw.slice(0, sp)).toLowerCase();
  const rest = sp === -1 ? '' : raw.slice(sp + 1).trim();
  const args = rest ? rest.split(/\s+/) : [];
  const inChan = active && active !== STATUS;
  switch (cmd) {
    case 'join': case 'j': if (args[0]) irc.join(args[0]); break;
    case 'part': case 'leave': irc.part(args[0] || (inChan ? active : '')); break;
    case 'msg': case 'query': if (args[0]) irc.say(args[0], args.slice(1).join(' ')); break;
    case 'me':
      if (inChan && rest) {
        irc.send(`PRIVMSG ${active} :ACTION ${rest}`);
        appendMsg({ channel: active, from: irc.nick, text: rest, self: true, time: new Date().toISOString() });
      }
      break;
    case 'nick': if (args[0]) irc.send(`NICK ${args[0]}`); break;
    case 'topic': if (inChan) irc.send(`TOPIC ${active}${rest ? ' :' + rest : ''}`); break;
    case 'names': irc.send(`NAMES ${args[0] || (inChan ? active : '')}`.trim()); break;
    case 'list': irc.send(`LIST ${rest}`.trim()); break;
    case 'whois': if (args[0]) irc.send(`WHOIS ${args[0]}`); break;
    case 'quit': irc.quit(); break;
    case 'raw': case 'quote': if (rest) irc.send(rest); break;
    default: irc.send(raw); // generic passthrough — any other IRC command
  }
}

// Prefill from saved config — and auto-connect if a full account is set up.
(async () => {
  const { [STORE_KEY]: cfg } = await chrome.storage.local.get(STORE_KEY);
  if (cfg) {
    $('irc-url').value = cfg.url || $('irc-url').value;
    $('irc-nick').value = cfg.nick || '';
    $('irc-pass').value = cfg.password || '';
    $('irc-chans').value = (cfg.channels || ['#general']).join(' ');
    $('irc-remember').checked = true;
    // Saved nick + password = a configured account → connect without a click.
    if (cfg.nick && cfg.password) {
      setStatus('Auto-connecting…');
      irc.connect(cfg);
    }
  }
})();
