#!/usr/bin/env node
// Single source of truth for the shared settings UI lives in the EXTENSION
// (apps/desktop/extensions/ai-sidebar). The two settings pages live in separate
// bundler-less static roots (chrome-extension:// and tronbrowser.dev) that can't
// import across origins, so we copy the shared modules into the web app. Run this
// after editing feeds.js / settings-sections.js. CI can run it with --check to
// fail if the copies drifted.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'apps/desktop/extensions/ai-sidebar');
const DST = join(root, 'apps/web/public');
const FILES = ['feeds.js', 'settings-sections.js'];
const check = process.argv.includes('--check');

let drift = 0;
for (const f of FILES) {
  const src = readFileSync(join(SRC, f), 'utf8');
  const dstPath = join(DST, f);
  let dst = '';
  try { dst = readFileSync(dstPath, 'utf8'); } catch { /* missing */ }
  if (src === dst) { console.log(`ok   ${f}`); continue; }
  if (check) { console.error(`DRIFT ${f} — run: node scripts/sync-shared-settings.mjs`); drift++; continue; }
  writeFileSync(dstPath, src);
  console.log(`sync ${f} -> apps/web/public/`);
}
if (check && drift) process.exit(1);
