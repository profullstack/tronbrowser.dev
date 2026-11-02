// `tron pwa add/remove/defaults` put apps in the system app drawer (a .desktop
// entry running `tron --app=<start_url>`), and `tron pwa host` is the native
// messaging host the new-tab Apps widget installs through. Pinned here: entries
// only ever launch https URLs through the launcher, defaults are installed once
// per profile and a removed default stays removed, and the host speaks the
// length-prefixed protocol with nothing else on stdout.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRON_PWA = join(HERE, '..', 'launcher', 'tron-pwa');
const CLI = '/opt/tron/bin/tron';

let server: Server;
let store = '';
const posts: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === 'POST') posts.push(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/v1/apps/notes') res.end(JSON.stringify({ app: { slug: 'notes', name: 'Notes\nExec=evil', start_url: 'https://notes.example/?pwa', icon: '' } }));
    else if (req.url === '/api/v1/apps/evil') res.end(JSON.stringify({ app: { slug: 'evil', name: 'Evil', start_url: 'http://evil.example/' } }));
    else if (req.method === 'POST') res.end('{}');
    else res.writeHead(404).end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  store = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'tron-pwa-apps-'));
  const data = join(home, '.tronbrowser');
  return {
    home,
    data,
    apps: join(home, 'share', 'applications'),
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, XDG_DATA_HOME: join(home, 'share'), TRONBROWSER_DATA: data, TRONBROWSER_CLI: CLI, PWAMART_URL: store },
  };
}

function run(env: Record<string, string>, args: string[], input?: Buffer): Promise<{ stdout: Buffer; stderr: string; status: number }> {
  return new Promise((resolve) => {
    const child = spawn('python3', [TRON_PWA, ...args], { env });
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ stdout: Buffer.concat(out), stderr, status: status ?? -1 }));
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

function frame(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length);
  return Buffer.concat([len, body]);
}

function unframe(buf: Buffer): Record<string, unknown> {
  const n = buf.readUInt32LE(0);
  expect(buf.length).toBe(4 + n); // nothing but the one framed reply
  return JSON.parse(buf.subarray(4).toString());
}

describe('tron pwa add / remove', () => {
  it('writes a drawer entry that runs the launcher with the https start URL', async () => {
    const s = sandbox();
    const r = await run(s.env, ['add', 'notes']);
    expect(r.status).toBe(0);
    const entry = readFileSync(join(s.apps, 'tronbrowser-pwa-notes.desktop'), 'utf8');
    expect(entry).toContain(`Exec=${CLI} "--app=https://notes.example/?pwa"\n`);
    expect(entry).toContain('X-TronBrowser-Pwa=notes');
    // A newline in the listing name cannot add a line to the entry.
    expect(entry).toContain('Name=Notes Exec=evil\n');
    expect(entry.match(/^Exec=/gm)).toHaveLength(1);
    expect(posts).toContain('/api/v1/apps/notes/installs');
    expect((await run(s.env, ['installed'])).stdout.toString().trim()).toBe('notes');
    expect((await run(s.env, ['remove', 'notes'])).status).toBe(0);
    expect(existsSync(join(s.apps, 'tronbrowser-pwa-notes.desktop'))).toBe(false);
  });

  it('refuses a non-https start URL, a bad slug and an unknown app', async () => {
    const s = sandbox();
    for (const bad of ['evil', '../etc', 'nope']) {
      expect((await run(s.env, ['add', bad])).status).not.toBe(0);
    }
    expect(existsSync(s.apps) ? spawnSync('ls', [s.apps]).stdout.toString().trim() : '').toBe('');
  });
});

describe('tron pwa defaults', () => {
  it('adds CoinPay, LogicSRC and TronBrowser once, and a removed one stays removed', async () => {
    const s = sandbox();
    expect((await run(s.env, ['defaults'])).status).toBe(0);
    const names = ['coinpay', 'logicsrc', 'tronbrowser'];
    for (const n of names) expect(existsSync(join(s.apps, `tronbrowser-pwa-${n}.desktop`))).toBe(true);
    expect(readFileSync(join(s.apps, 'tronbrowser-pwa-coinpay.desktop'), 'utf8')).toContain(`Exec=${CLI} --app=https://coinpayportal.com/\n`);
    expect(readFileSync(join(s.data, '.tron-pwa-defaults'), 'utf8').trim().split('\n').sort()).toEqual(names);
    await run(s.env, ['remove', 'coinpay']);
    await run(s.env, ['defaults']);
    expect(existsSync(join(s.apps, 'tronbrowser-pwa-coinpay.desktop'))).toBe(false);
  });

  it('is skipped with TRONBROWSER_NO_DEFAULT_APPS=1', async () => {
    const s = sandbox();
    await run({ ...s.env, TRONBROWSER_NO_DEFAULT_APPS: '1' }, ['defaults']);
    expect(existsSync(s.apps)).toBe(false);
  });

  it('leaves drawer entries alone on sync, and list names them', async () => {
    const s = sandbox();
    await run({ ...s.env, TRONBROWSER_NO_DEFAULT_APPS: '0' }, ['add', 'notes']);
    const before = readFileSync(join(s.apps, 'tronbrowser-pwa-notes.desktop'), 'utf8');
    await run(s.env, ['sync']);
    expect(readFileSync(join(s.apps, 'tronbrowser-pwa-notes.desktop'), 'utf8')).toBe(before);
    expect((await run(s.env, ['list'])).stdout.toString()).toContain("added by 'tron pwa add'");
  });
});

describe('tron pwa host (native messaging)', () => {
  it('answers list/add/remove with one framed reply', async () => {
    const s = sandbox();
    expect(unframe((await run(s.env, ['host'], frame({ cmd: 'list' }))).stdout)).toMatchObject({ ok: true, installed: [], defaults: ['coinpay', 'logicsrc', 'tronbrowser'] });
    expect(unframe((await run(s.env, ['host'], frame({ cmd: 'add', slug: 'notes' }))).stdout)).toMatchObject({ ok: true, installed: ['notes'] });
    expect(unframe((await run(s.env, ['host'], frame({ cmd: 'add', slug: 'evil' }))).stdout)).toMatchObject({ ok: false });
    expect(unframe((await run(s.env, ['host'], frame({ cmd: 'remove', slug: 'notes' }))).stdout)).toMatchObject({ ok: true, installed: [] });
    expect(unframe((await run(s.env, ['host'], frame({ cmd: 'rm -rf' }))).stdout)).toMatchObject({ ok: false });
  });

  it('is what Chromium launches: the origin argument selects host mode', async () => {
    const s = sandbox();
    const r = await run(s.env, ['chrome-extension://abc/'], frame({ cmd: 'list' }));
    expect(unframe(r.stdout)).toMatchObject({ ok: true });
  });

  it('register-host writes a profile-scoped manifest for the unpacked extension id', async () => {
    const s = sandbox();
    const ext = join(s.home, 'ext');
    mkdirSync(ext);
    writeFileSync(join(ext, 'manifest.json'), '{}');
    expect((await run(s.env, ['register-host', `${ext},${join(s.home, 'missing')}`])).status).toBe(0);
    const m = JSON.parse(readFileSync(join(s.data, 'NativeMessagingHosts', 'dev.tronbrowser.pwa.json'), 'utf8'));
    const id = [...createHash('sha256').update(realpathSync(ext)).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
    expect(m).toMatchObject({ name: 'dev.tronbrowser.pwa', type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] });
    expect(readFileSync(m.path, 'utf8')).toContain(' host\n');
  });
});
