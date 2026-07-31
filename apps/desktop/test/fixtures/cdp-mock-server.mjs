// Minimal CDP DevTools HTTP endpoint mock, standing in for Chromium so the
// tron-session shell engine can be integration-tested without a browser.
// The fake shim exec-replaces into this, so tron-session tracks its pid exactly
// like Chromium on Linux. Behavior mirrors packages/browser-core/src/automation.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const dataDir = process.env.TRONBROWSER_DATA;
const reqPort = Number(process.env.TRON_AUTOMATION_PORT ?? '0');

let counter = 0;
const targets = [];
let PORT = 0;

function newTarget(url) {
  counter += 1;
  const id = `TAB${String(counter).padStart(4, '0')}`;
  const t = {
    id,
    type: 'page',
    title: url,
    url,
    webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/${id}`,
  };
  targets.push(t);
  return t;
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}

const server = createServer((req, res) => {
  const path = req.url ?? '';
  if (path === '/json/version') {
    return send(res, 200, {
      Browser: 'MockChrome/1.0',
      webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/browser/mock`,
    });
  }
  if (path === '/json' || path === '/json/list') {
    return send(res, 200, targets);
  }
  if (path.startsWith('/json/new')) {
    const q = path.indexOf('?');
    const url = q >= 0 ? path.slice(q + 1) : 'about:blank';
    return send(res, 200, newTarget(url));
  }
  if (path.startsWith('/json/close/')) {
    const id = path.slice('/json/close/'.length);
    const before = targets.length;
    for (let i = targets.length - 1; i >= 0; i -= 1) {
      if (targets[i].id === id) targets.splice(i, 1);
    }
    return send(res, targets.length < before ? 200 : 404, { closed: id });
  }
  if (path.startsWith('/json/activate/')) {
    const id = path.slice('/json/activate/'.length);
    const ok = targets.some((t) => t.id === id);
    return send(res, ok ? 200 : 404, { activated: id });
  }
  send(res, 404, { error: 'not found' });
});

server.listen(reqPort, '127.0.0.1', () => {
  PORT = server.address().port;
  newTarget('chrome://newtab/'); // a session always opens with one page
  const apf = `${dataDir}/DevToolsActivePort`;
  mkdirSync(dirname(apf), { recursive: true });
  writeFileSync(apf, `${PORT}\n/devtools/browser/mock\n`);
  process.stderr.write(`mock cdp on 127.0.0.1:${PORT}\n`);
});
