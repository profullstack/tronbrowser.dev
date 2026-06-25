#!/usr/bin/env node
// Sets ONE version across every app/package/service in the monorepo, plus the
// Expo app and the AI sidebar extension. The release tag is the source of truth:
// `node scripts/set-version.mjs 0.1.0` (or `pnpm version:set 0.1.0`).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error('usage: set-version.mjs <semver>  (e.g. 0.1.0)');
  process.exit(1);
}

const updated = [];

function setJson(path, mutate) {
  if (!existsSync(path)) return;
  const json = JSON.parse(readFileSync(path, 'utf8'));
  if (mutate(json)) {
    writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
    updated.push(path.replace(root + '/', ''));
  }
}

// Root + every workspace member package.json.
const groups = ['.', 'apps', 'packages', 'services'];
const pkgJsons = [join(root, 'package.json')];
for (const g of ['apps', 'packages', 'services']) {
  const dir = join(root, g);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) pkgJsons.push(join(dir, name, 'package.json'));
}
for (const p of pkgJsons) setJson(p, (j) => (j.version = version, true));

// Expo app + AI sidebar extension carry their own version fields.
setJson(join(root, 'apps/mobile/app.json'), (j) => {
  if (j.expo) { j.expo.version = version; return true; }
  return false;
});
setJson(join(root, 'apps/desktop/extensions/ai-sidebar/manifest.json'), (j) => (j.version = version, true));

console.log(`Set version ${version} in ${updated.length} files:`);
for (const f of updated) console.log('  ' + f);
