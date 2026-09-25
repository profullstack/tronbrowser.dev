#!/usr/bin/env node
// Forward-only migration runner. Applies every unapplied migration (in filename
// order) and records it in a schema_migrations table. Idempotent.
//
//   doppler run -- pnpm db:migrate
//   pnpm db:status        # show applied vs pending without applying
//
// Postgres (the production path since 2026-09): DATABASE_URL (or the alias
// TRONBROWSER_DB_URL) is postgres:// and packages/storage/migrations-pg/*.sql
// is applied through @profullstack/libsql-pg, one transaction per file.
//
// Legacy Turso/libSQL: a libsql:// or file: URL (or TRONBROWSER_DB_PATH) still
// applies packages/storage/migrations/*.sql through @libsql/client, so the old
// database can be kept in step until the cutover is proven. The API itself
// refuses anything but Postgres; this script is the only libSQL user left.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATUS_ONLY = process.argv.includes('--status');

const url = process.env.DATABASE_URL || process.env.TRONBROWSER_DB_URL;
const filePath = process.env.TRONBROWSER_DB_PATH;
const isPostgres = !!url && /^postgres(ql)?:\/\//i.test(url);

if (!url && !filePath) {
  console.error('Set DATABASE_URL to a postgres:// URL (or, for the legacy database, TRONBROWSER_DB_URL + _AUTH_TOKEN / TRONBROWSER_DB_PATH).');
  process.exit(1);
}

const DIR = process.env.MIGRATIONS_DIR || join(ROOT, isPostgres ? 'packages/storage/migrations-pg' : 'packages/storage/migrations');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

if (isPostgres) {
  const { createClient } = await import('@profullstack/libsql-pg');
  const client = createClient({ url, dialect: 'postgres' });
  const pool = client.pool;
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
     name TEXT PRIMARY KEY,
     applied_at timestamptz NOT NULL DEFAULT now()
   )`);
  const applied = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  if (STATUS_ONLY) {
    for (const f of files) console.log(`${applied.has(f) ? 'applied' : 'pending'}  ${f}`);
    await client.close();
    process.exit(0);
  }
  let n = 0;
  for (const f of files) {
    if (applied.has(f)) { console.log('skip   ', f); continue; }
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');
      await conn.query(readFileSync(join(DIR, f), 'utf8'));
      await conn.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      await conn.query('COMMIT');
    } catch (err) {
      await conn.query('ROLLBACK').catch(() => {});
      console.error(`failed  ${f}: ${err.message}`);
      await client.close();
      process.exit(1);
    } finally {
      conn.release();
    }
    console.log('applied', f);
    n++;
  }
  console.log(n ? `\nApplied ${n} migration(s).` : '\nDatabase is up to date.');
  await client.close();
} else {
  console.warn('Legacy libSQL target: applying the SQLite migrations. The API runs on Postgres; set DATABASE_URL=postgres://... for the current schema.');
  const { createClient } = await import('@libsql/client');
  let db;
  if (filePath) db = createClient({ url: 'file:' + filePath.replace(/^file:/, '') });
  else if (url.startsWith('file:') || url.startsWith('./') || url.startsWith('/')) {
    db = createClient({ url: url.startsWith('file:') ? url : 'file:' + url });
  } else {
    const authToken = process.env.TRONBROWSER_DB_AUTH_TOKEN;
    if (!authToken) {
      console.error('Remote libSQL URL requires TRONBROWSER_DB_AUTH_TOKEN.');
      process.exit(1);
    }
    db = createClient({ url, authToken });
  }
  await db.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  );
  const applied = new Set((await db.execute('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  if (STATUS_ONLY) {
    for (const f of files) console.log(`${applied.has(f) ? 'applied' : 'pending'}  ${f}`);
    process.exit(0);
  }
  let n = 0;
  for (const f of files) {
    if (applied.has(f)) { console.log('skip   ', f); continue; }
    await db.executeMultiple(readFileSync(join(DIR, f), 'utf8'));
    await db.execute({ sql: 'INSERT INTO schema_migrations (name) VALUES (?)', args: [f] });
    console.log('applied', f);
    n++;
  }
  console.log(n ? `\nApplied ${n} migration(s).` : '\nDatabase is up to date.');
}
