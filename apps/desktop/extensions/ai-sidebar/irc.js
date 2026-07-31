// Minimal IRC-over-WebSocket client for TronBrowser's Chat tab. Connects
// directly to Ergo's WebSocket listener (e.g. wss://irc.profullstack.com/irc),
// authenticates with SASL PLAIN, and exposes a small event interface. No
// gateway — the browser speaks IRCv3 over the WS using the `text.ircv3.net`
// subprotocol (each frame = one IRC line).

const DEFAULT_URL = 'wss://irc.profullstack.com/irc';

function parseLine(line) {
  // [@tags] [:prefix] COMMAND [params...] [:trailing]
  let rest = line;
  const tags = {};
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    rest.slice(1, sp).split(';').forEach((kv) => {
      const [k, v] = kv.split('=');
      tags[k] = v ?? true;
    });
    rest = rest.slice(sp + 1);
  }
  let prefix = '';
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  const params = [];
  while (rest.length) {
    if (rest.startsWith(':')) { params.push(rest.slice(1)); break; }
    const sp = rest.indexOf(' ');
    if (sp === -1) { params.push(rest); break; }
    params.push(rest.slice(0, sp));
    rest = rest.slice(sp + 1);
  }
  const command = params.shift() || '';
  const nick = prefix.includes('!') ? prefix.slice(0, prefix.indexOf('!')) : prefix;
  return { tags, prefix, nick, command: command.toUpperCase(), params };
}

export class IrcClient extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.nick = '';
    this.connected = false;
    this.channels = new Set();
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  /** opts: { url, nick, password, channels[] } */
  connect(opts) {
    this.opts = { url: DEFAULT_URL, channels: ['#general'], ...opts };
    this.nick = this.opts.nick;
    this._caps = new Set();
    this.emit('status', { state: 'connecting' });
    let ws;
    try {
      ws = new WebSocket(this.opts.url, 'text.ircv3.net');
    } catch (e) {
      this.emit('status', { state: 'error', error: String(e && e.message || e) });
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.send('CAP LS 302');
      this.send(`NICK ${this.nick}`);
      this.send(`USER ${this.nick} 0 * :${this.nick}`);
    };
    ws.onmessage = (ev) => {
      String(ev.data).split('\r\n').forEach((l) => l && this.handle(parseLine(l)));
    };
    ws.onclose = () => {
      this.connected = false;
      this.emit('status', { state: 'disconnected' });
    };
    ws.onerror = () => this.emit('status', { state: 'error', error: 'WebSocket error' });
  }

  send(line) { if (this.ws && this.ws.readyState === 1) this.ws.send(line); }

  handle(msg) {
    const { command, params, nick, prefix } = msg;
    switch (command) {
      case 'PING': this.send(`PONG :${params[0] || ''}`); break;
      case 'CAP': {
        const sub = params[1];
        const list = params[params.length - 1] || '';
        if (sub === 'LS') {
          // 302 multiline: a `*` param before the trailing list means more lines.
          list.split(' ').filter(Boolean).forEach((c) => this._caps.add(c.split('=')[0]));
          if (params[2] !== '*') {
            const want = ['sasl', 'server-time', 'message-tags'].filter((c) => this._caps.has(c));
            if (want.length) this.send(`CAP REQ :${want.join(' ')}`);
            else this.send('CAP END');
          }
        } else if (sub === 'ACK') {
          // Authenticate as soon as SASL is acknowledged. CAP END comes after.
          if (list.includes('sasl')) this.send('AUTHENTICATE PLAIN');
          else this.send('CAP END');
        } else if (sub === 'NAK') {
          this.send('CAP END');
        }
        break;
      }
      case 'AUTHENTICATE':
        if (params[0] === '+') {
          const token = btoa(`\0${this.nick}\0${this.opts.password || ''}`);
          this.send(`AUTHENTICATE ${token}`);
        }
        break;
      case '900': break; // RPL_LOGGEDIN
      case '903': this.send('CAP END'); break; // SASL success
      case '902': case '904': case '905': case '906': // SASL failed/aborted
        this.emit('status', { state: 'error', error: 'Login failed — check your username and IRC password.' });
        this.quit(); // do NOT CAP END; the server requires SASL
        break;
      case '001': // welcome
        this.connected = true;
        this.emit('status', { state: 'connected' });
        (this.opts.channels || []).forEach((c) => this.join(c));
        break;
      case 'JOIN': {
        const chan = params[0];
        if (nick === this.nick) { this.channels.add(chan); this.emit('joined', { channel: chan }); }
        this.emit('system', { channel: chan, text: `${nick} joined` });
        break;
      }
      case 'PART': this.emit('system', { channel: params[0], text: `${nick} left` }); break;
      case 'QUIT': this.emit('system', { channel: null, text: `${nick} quit` }); break;
      case 'NICK': this.emit('system', { channel: null, text: `${nick} is now ${params[0]}` }); break;
      case 'PRIVMSG': case 'NOTICE': {
        const target = params[0];
        const chan = target === this.nick ? nick : target; // DMs keyed by sender nick
        this.emit('message', {
          channel: chan, from: nick || prefix, text: params[1] || '',
          time: msg.tags['time'] || new Date().toISOString(),
          notice: command === 'NOTICE',
        });
        break;
      }
      case '332': this.emit('topic', { channel: params[1], topic: params[2] }); break;
      case '353': // names
        this.emit('names', { channel: params[2], names: (params[3] || '').trim().split(' ') });
        break;
      case 'ERROR':
        this.emit('status', { state: 'error', error: params[0] || 'server error' });
        break;
      default:
        // Surface ALL server numerics (LIST 322, NAMES 366, WHOIS 311-319,
        // MOTD 372, errors 4xx/5xx, …) to the status window so commands that
        // reply with numerics actually show output.
        if (/^\d{3}$/.test(command)) {
          this.emit('system', { channel: null, text: params.slice(1).join(' ') });
        }
    }
  }

  join(channel) { const c = channel.startsWith('#') ? channel : '#' + channel; this.send(`JOIN ${c}`); }
  part(channel) { this.send(`PART ${channel}`); this.channels.delete(channel); }
  say(channel, text) {
    this.send(`PRIVMSG ${channel} :${text}`);
    this.emit('message', { channel, from: this.nick, text, time: new Date().toISOString(), self: true });
  }
  quit() { try { this.send('QUIT :TronBrowser'); this.ws && this.ws.close(); } catch (_) { /* */ } }
}

export { DEFAULT_URL as IRC_DEFAULT_URL };
