// `tron pwa install` resolves a pwamart.com listing to its start URL and opens it as
// a TronBrowser app window. Pinned here: it only ever launches https URLs, it goes
// through the launcher (never the engine), and a slug is looked up on the store.

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRON_PWA = join(HERE, '..', 'launcher', 'tron-pwa');
const CLI = '/opt/tron/bin/tron';

const env = (extra: Record<string, string> = {}) => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/nonexistent', TRONBROWSER_CLI: CLI, ...extra });

function runAsync(args: string[], extra: Record<string, string>): Promise<{ stdout: string; status: number }> {
  return new Promise((resolve) => {
    const child = spawn('python3', [TRON_PWA, ...args], { env: env(extra) });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.on('close', (status) => resolve({ stdout, status: status ?? -1 }));
  });
}

describe('tron pwa install', () => {
  it('opens an https URL as an app window through the launcher', () => {
    const r = spawnSync('python3', [TRON_PWA, 'install', 'https://app.example/', '--dry-run'], { encoding: 'utf8', env: env() });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`${CLI} --app=https://app.example/`);
  });

  it('refuses anything that is not a slug or an https URL', () => {
    for (const bad of ['javascript:alert(1)', 'http://app.example/', '../etc/passwd', '']) {
      const r = spawnSync('python3', [TRON_PWA, 'install', bad, '--dry-run'], { encoding: 'utf8', env: env() });
      expect(r.status).not.toBe(0);
      expect(r.stdout).toBe('');
    }
  });

  it('looks a slug up on pwamart and launches its start_url', async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/v1/apps/notes') res.end(JSON.stringify({ app: { slug: 'notes', url: 'https://notes.example/', start_url: 'https://notes.example/?pwa' } }));
      else if (req.url === '/api/v1/apps/evil') res.end(JSON.stringify({ app: { slug: 'evil', url: 'http://evil.example/', start_url: 'http://evil.example/' } }));
      else res.writeHead(404).end('{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const ok = await runAsync(['install', 'notes', '--dry-run'], { PWAMART_URL: `http://127.0.0.1:${port}` });
      expect(ok.status).toBe(0);
      expect(ok.stdout.trim()).toBe(`${CLI} --app=https://notes.example/?pwa`);
      const evil = await runAsync(['install', 'evil', '--dry-run'], { PWAMART_URL: `http://127.0.0.1:${port}` });
      expect(evil.status).not.toBe(0);
      const missing = await runAsync(['install', 'nope', '--dry-run'], { PWAMART_URL: `http://127.0.0.1:${port}` });
      expect(missing.status).not.toBe(0);
      // A dry run never counts an install.
      expect(seen.some((s) => s.startsWith('POST'))).toBe(false);
    } finally {
      server.close();
    }
  });
});
