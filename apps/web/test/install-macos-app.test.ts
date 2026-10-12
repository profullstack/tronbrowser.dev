// Until this existed, install.sh wrote a freedesktop .desktop file on EVERY
// platform. macOS does not read those — only .app bundles are indexed — so a
// Mac install left nothing in Launchpad, Spotlight, Finder or the Dock, and
// typing `tron` in a terminal was the only way to start the browser. The
// installer still said "find 'TronBrowser' in your app menu".
//
// What has to hold: macOS gets a bundle macOS will actually launch, Linux still
// gets its .desktop entry and no bundle, and `remove` takes ours away without
// touching the Chromium the browser drives.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALL_SH = join(HERE, '..', 'public', 'install.sh');
const onMac = process.platform === 'darwin';

const roots: string[] = [];

/** A prefix that looks like a finished install, minus the .app bundle. */
function installed(): { home: string; prefix: string; app: string } {
  const home = mkdtempSync(join(tmpdir(), 'tron-macapp-'));
  roots.push(home);
  const prefix = join(home, '.local');
  const dir = join(prefix, 'lib', 'tronbrowser', 'tronbrowser');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(prefix, 'bin'), { recursive: true });
  writeFileSync(join(prefix, 'lib', 'tronbrowser', 'VERSION'), 'v3.16.1\n');
  // A 1x1 PNG, so the sips/iconutil icon path runs for real.
  writeFileSync(
    join(dir, 'tronbrowser.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  return { home, prefix, app: join(home, 'Applications', 'TronBrowser.app') };
}

function sh(args: string[], env: Record<string, string>, home: string) {
  const result = spawnSync('sh', [INSTALL_SH, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, ...env },
  });
  return { out: `${result.stdout}${result.stderr}`, status: result.status };
}

const plist = (app: string) => readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8');

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe.skipIf(!onMac)('install.sh macOS app bundle', () => {
  it('builds a bundle macOS will launch as TronBrowser', () => {
    const { home, prefix, app } = installed();
    const { status } = sh(['mac-app'], { TRONBROWSER_PREFIX: prefix }, home);
    expect(status).toBe(0);

    // mdls is the real test of "will Finder and Launchpad treat this as an app".
    const kind = spawnSync('mdls', ['-name', 'kMDItemContentType', app], { encoding: 'utf8' });
    expect(kind.stdout).toContain('com.apple.application-bundle');

    const name = spawnSync('mdls', ['-name', 'kMDItemDisplayName', app], { encoding: 'utf8' });
    expect(name.stdout).toContain('TronBrowser');
  });

  it('writes a plist macOS can parse, carrying the installed version', () => {
    const { home, prefix, app } = installed();
    sh(['mac-app'], { TRONBROWSER_PREFIX: prefix }, home);
    const parsed = spawnSync('plutil', ['-lint', join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' });
    expect(parsed.status).toBe(0);
    // CFBundleVersion must be a bare dotted number — the tag's "v" is stripped.
    expect(plist(app)).toContain('<key>CFBundleVersion</key><string>3.16.1</string>');
  });

  it('execs the tron CLI by absolute path', () => {
    // A GUI launch inherits almost no PATH, so a bare `tron` would not resolve.
    const { home, prefix, app } = installed();
    sh(['mac-app'], { TRONBROWSER_PREFIX: prefix }, home);
    const exe = readFileSync(join(app, 'Contents', 'MacOS', 'TronBrowser'), 'utf8');
    expect(exe).toContain(`exec "${join(prefix, 'bin', 'tron')}" "$@"`);
    expect(existsSync(join(app, 'Contents', 'MacOS', 'TronBrowser'))).toBe(true);
  });

  it('declares no URL types, so it cannot be set as a broken default browser', () => {
    // macOS hands a chosen browser its URLs as a GURL Apple Event, which a
    // shell-script executable cannot receive. Listing http/https would put
    // TronBrowser in the default-browser picker and then drop every link.
    const { home, prefix, app } = installed();
    sh(['mac-app'], { TRONBROWSER_PREFIX: prefix }, home);
    expect(plist(app)).not.toContain('CFBundleURLTypes');
  });

  it('honours TB_NO_APP=1', () => {
    const { home, prefix, app } = installed();
    sh(['mac-app'], { TRONBROWSER_PREFIX: prefix, TB_NO_APP: '1' }, home);
    expect(existsSync(app)).toBe(false);
  });

  it('removes its own bundle on uninstall and leaves Chromium alone', () => {
    const { home, prefix, app } = installed();
    sh(['mac-app'], { TRONBROWSER_PREFIX: prefix }, home);
    expect(existsSync(app)).toBe(true);

    // A Chromium.app of the user's own, which predates TronBrowser.
    const chromium = join(home, 'Applications', 'Chromium.app');
    mkdirSync(join(chromium, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(chromium, 'Contents', 'MacOS', 'Chromium'), '', { mode: 0o755 });

    sh(['remove'], { TRONBROWSER_PREFIX: prefix, TB_NO_KILL: '1' }, home);
    expect(existsSync(app)).toBe(false);
    expect(existsSync(chromium)).toBe(true);
  });
});

describe('install.sh desktop entry', () => {
  it.skipIf(!onMac)('writes no .desktop file on macOS — nothing reads it there', () => {
    const { home, prefix } = installed();
    sh(['mac-app'], { TRONBROWSER_PREFIX: prefix }, home);
    expect(existsSync(join(prefix, 'share', 'applications', 'tronbrowser.desktop'))).toBe(false);
  });
});
