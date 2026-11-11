// /privacy and /terms are static pages Caddy rewrites to privacy.html and
// terms.html. Every page with the site footer links both, ahead of the shared
// Profullstack rows (whose Terms/Privacy point at profullstack.com).

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PUBLIC = join(HERE, '..', 'public');
const read = (p: string) => readFileSync(p, 'utf8');

describe('legal pages', () => {
  it('terms.html has its title, heading and effective date', () => {
    const html = read(join(PUBLIC, 'terms.html'));
    expect(html).toMatch(/<title>Terms of Service[^<]*<\/title>/);
    expect(html).toContain('<h1>Terms of Service</h1>');
    expect(html).toContain('Effective date: <time datetime="2026-11-11">November 11, 2026</time>');
  });

  it('privacy.html has its heading and the AI agents and MCP section', () => {
    const html = read(join(PUBLIC, 'privacy.html'));
    expect(html).toMatch(/<title>Privacy Policy[^<]*<\/title>/);
    expect(html).toContain('<h1>Privacy Policy</h1>');
    expect(html).toContain('<h2>AI agents and MCP</h2>');
    expect(html).toContain('https://tronbrowser.dev/mcp/tron');
  });

  it('no em or en dashes in either page', () => {
    for (const f of ['privacy.html', 'terms.html']) expect(read(join(PUBLIC, f))).not.toMatch(/[–—]/);
  });

  it('Caddy serves /terms and /privacy', () => {
    const caddy = read(join(ROOT, 'Caddyfile'));
    expect(caddy).toMatch(/@terms path \/terms\s+rewrite @terms \/terms\.html/);
    expect(caddy).toMatch(/@privacy path \/privacy\s+rewrite @privacy \/privacy\.html/);
  });

  it('every page with the site footer links the site-local /privacy and /terms', () => {
    const dirs = [PUBLIC, join(ROOT, 'apps', 'extensions', 'public')];
    let pages = 0;
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.html'))) {
        const html = read(join(dir, f));
        if (!html.includes('data-profullstack-footer')) continue;
        pages++;
        expect(html, f).toContain('{"label":"Privacy","href":"/privacy"},{"label":"Terms","href":"/terms"}');
        expect(html, f).toContain('<a href="/privacy">Privacy</a><a href="/terms">Terms</a>');
      }
    }
    expect(pages).toBeGreaterThanOrEqual(13);
  });
});
