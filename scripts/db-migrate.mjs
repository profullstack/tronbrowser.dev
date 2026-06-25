#!/usr/bin/env node
// Forward-only SQLite/libSQL migration runner. Applies every unapplied
// packages/storage/migrations/*.sql (in filename order) and records them in a
// schema_migrations table. Idempotent. Config from env (Doppler/.env):
//   TRONBROWSER_DB_URL + TRONBROWSER_DB_AUTH_TOKEN (Turso), or TRONBROWSER_DB_PATH.
//
//   doppler run -- pnpm db:migrate
//   pnpm db:status        # show applied vs pending without applying
import { createClient } from '@libsql/client';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'packages/storage/migrations');
const STATUS_ONLY = process.argv.includes('--status');

function clientFromEnv() {
  const path = process.env.TRONBROWSER_DB_PATH;
  if (path) return createClient({ url: 'file:' + path.replace(/^file:/, '') });
  const url = process.env.TRONBROWSER_DB_URL;
  if (!url) {
    console.error('Set TRONBROWSER_DB_URL (+ _AUTH_TOKEN) or TRONBROWSER_DB_PATH.');
    process.exit(1);
  }
  if (url.startsWith('file:') || url.startsWith('./') || url.startsWith('/')) {
    return createClient({ url: url.startsWith('file:') ? url : 'file:' + url });
  }
  const authToken = process.env.TRONBROWSER_DB_AUTH_TOKEN;
  if (!authToken) {
    console.error('Remote DB URL requires TRONBROWSER_DB_AUTH_TOKEN.');
    process.exit(1);
  }
  return createClient({ url, authToken });
}

const db = clientFromEnv();
await db.execute(
  `CREATE TABLE IF NOT EXISTS schema_migrations (
     name TEXT PRIMARY KEY,
     applied_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
);

const applied = new Set((await db.execute('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

if (STATUS_ONLY) {
  for (const f of files) console.log(`${applied.has(f) ? '✓ applied' : '• pending'}  ${f}`);
  process.exit(0);
}

let n = 0;
for (const f of files) {
  if (applied.has(f)) { console.log('• skip   ', f); continue; }
  const sql = readFileSync(join(DIR, f), 'utf8');
  await db.executeMultiple(sql);
  await db.execute({ sql: 'INSERT INTO schema_migrations (name) VALUES (?)', args: [f] });
  console.log('✓ applied', f);
  n++;
}
console.log(n ? `\nApplied ${n} migration(s).` : '\nDatabase is up to date.');
