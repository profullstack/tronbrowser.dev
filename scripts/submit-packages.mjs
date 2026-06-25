#!/usr/bin/env node
// Refresh package-manager manifests for a release and (optionally) submit them.
// Mirrors pairux.com's scripts/submit-packages.ts approach, kept in this monorepo.
//
// Usage:
//   node scripts/submit-packages.mjs -v 0.1.0 -p homebrew -p aur [--dry-run]
//   node scripts/submit-packages.mjs -v 0.1.0 -p all --dry-run
//
// It fetches the GitHub release asset checksums and rewrites version + sha256 in
// the checked-in manifests under distribution/. Actual submission (push to a tap
// repo / scoop bucket / AUR / winget-pkgs PR / choco push) is gated on the
// relevant secret being present and is intentionally a no-op without it.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.TRONBROWSER_REPO || 'profullstack/tronbrowser.dev';
const ALL = ['homebrew', 'scoop', 'winget', 'aur', 'apt', 'rpm', 'gentoo', 'nix', 'chocolatey', 'snap', 'flatpak', 'appimage', 'freebsd'];

const args = process.argv.slice(2);
let version = '';
let dryRun = false;
const pms = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-v') version = (args[++i] || '').replace(/^v/, '');
  else if (args[i] === '-p') pms.push(args[++i]);
  else if (args[i] === '--dry-run') dryRun = true;
}
if (!version) { console.error('usage: submit-packages.mjs -v <version> -p <pm> [--dry-run]'); process.exit(1); }
const targets = pms.includes('all') || pms.length === 0 ? ALL : pms;

const ASSET = {
  linux: `tronbrowser-linux-x64.tar.gz`,
  macos: `tronbrowser-macos.zip`,
  windows: `tronbrowser-win-x64.zip`,
};

async function sha256(asset) {
  const url = `https://github.com/${REPO}/releases/download/v${version}/${asset}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return createHash('sha256').update(buf).digest('hex');
}

function patch(file, replacers) {
  const path = join(ROOT, file);
  if (!existsSync(path)) return console.log(`  skip (missing): ${file}`);
  let s = readFileSync(path, 'utf8');
  for (const [re, val] of replacers) s = s.replace(re, val);
  if (dryRun) console.log(`  [dry-run] would update ${file}`);
  else { writeFileSync(path, s); console.log(`  updated ${file}`); }
}

const sums = {};
for (const [k, a] of Object.entries(ASSET)) sums[k] = await sha256(a);

for (const pm of targets) {
  console.log(`\n== ${pm} ==`);
  switch (pm) {
    case 'homebrew':
      patch('distribution/homebrew/tronbrowser.rb', [
        [/version "[^"]+"/, `version "${version}"`],
        [/download\/v[^/]+\/tronbrowser-macos\.zip/g, `download/v${version}/tronbrowser-macos.zip`],
        [/download\/v[^/]+\/tronbrowser-linux-x64\.tar\.gz/g, `download/v${version}/tronbrowser-linux-x64.tar.gz`],
        ...(sums.macos ? [[/sha256 "[0-9a-f]{64}"\n\n  on_linux/, `sha256 "${sums.macos}"\n\n  on_linux`]] : []),
        ...(sums.linux ? [[/sha256 "[0-9a-f]{64}"\n  end\n\n  def/, `sha256 "${sums.linux}"\n  end\n\n  def`]] : []),
      ]);
      break;
    case 'aur':
      patch('distribution/aur/PKGBUILD', [
        [/pkgver=[^\n]+/, `pkgver=${version}`],
        ...(sums.linux ? [[/sha256sums=\('[0-9a-f]{64}'\)/, `sha256sums=('${sums.linux}')`]] : []),
      ]);
      break;
    case 'nix':
      patch('distribution/nix/tronbrowser.nix', [
        [/version = "[^"]+"/, `version = "${version}"`],
        ...(sums.linux ? [[/sha256 = "[0-9a-f]{64}"/, `sha256 = "${sums.linux}"`]] : []),
      ]);
      break;
    case 'gentoo':
      console.log(`  rename distribution/gentoo/tronbrowser-bin-${version}.ebuild and bump SRC_URI (uses \${PV})`);
      break;
    case 'scoop':
      patch('distribution/scoop/tronbrowser.json', [
        [/"version": "[^"]+"/, `"version": "${version}"`],
        [/download\/v[^/]+\/tronbrowser-win-x64\.zip/g, `download/v${version}/tronbrowser-win-x64.zip`],
        ...(sums.windows ? [[/"hash": "[^"]+"/, `"hash": "${sums.windows}"`]] : []),
      ]);
      break;
    case 'winget':
      patch('distribution/winget/Profullstack.TronBrowser.installer.yaml', [
        [/PackageVersion: .*/, `PackageVersion: ${version}`],
        [/download\/v[^/]+\/tronbrowser-win-x64\.zip/g, `download/v${version}/tronbrowser-win-x64.zip`],
        ...(sums.windows ? [[/InstallerSha256: .*/, `InstallerSha256: ${sums.windows.toUpperCase()}`]] : []),
      ]);
      break;
    case 'chocolatey':
      patch('distribution/chocolatey/tronbrowser.nuspec', [[/<version>[^<]+<\/version>/, `<version>${version}</version>`]]);
      patch('distribution/chocolatey/tools/chocolateyinstall.ps1', [
        [/download\/v[^/]+\/tronbrowser-win-x64\.zip/g, `download/v${version}/tronbrowser-win-x64.zip`],
        ...(sums.windows ? [[/checksum64\s+= '[^']+'/, `checksum64     = '${sums.windows}'`]] : []),
      ]);
      break;
    case 'snap':
      patch('distribution/snap/snapcraft.yaml', [
        [/version: '[^']+'/, `version: '${version}'`],
        [/download\/v[^/]+\/tronbrowser-linux-x64\.tar\.gz/g, `download/v${version}/tronbrowser-linux-x64.tar.gz`],
      ]);
      break;
    case 'flatpak':
      patch('distribution/flatpak/dev.tronbrowser.TronBrowser.yml', [
        [/download\/v[^/]+\/tronbrowser-linux-x64\.tar\.gz/g, `download/v${version}/tronbrowser-linux-x64.tar.gz`],
        ...(sums.linux ? [[/sha256: (__SHA256_LINUX__|[0-9a-f]{64})/, `sha256: ${sums.linux}`]] : []),
      ]);
      break;
    case 'freebsd':
      patch('distribution/freebsd/Makefile', [[/DISTVERSION=\t[^\n]+/, `DISTVERSION=\t${version}`]]);
      break;
    case 'apt':
    case 'rpm':
      console.log(`  built by distribution/deb-rpm/build.sh (nfpm) during release; nothing to template`);
      break;
    case 'appimage':
      console.log(`  built by distribution/appimage/build.sh during release; attached to the GitHub release`);
      break;
    default:
      console.log(`  unknown package manager: ${pm}`);
  }
}

console.log(`\nDone (${dryRun ? 'dry run' : 'manifests updated'}).`);
