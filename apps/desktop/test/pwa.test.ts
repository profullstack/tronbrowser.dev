// tron-pwa rewrites files the desktop reads to launch apps. Two things have to
// hold every time: a shortcut belonging to some other Chrome is never touched,
// and a shortcut we do touch stays launchable. Both are the kind of thing that
// is invisible until someone's app menu breaks, so they are pinned here.

import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRON_PWA = join(HERE, '..', 'launcher', 'tron-pwa');

const CLI = '/opt/tron/bin/tron';
const APP_ID = 'abcdefghijklmnopabcdefghijklmnop';
const OTHER_ID = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';

type Env = { home: string; apps: string; profile: string };

function setup(): Env {
  const home = mkdtempSync(join(tmpdir(), 'tron-pwa-'));
  const apps = join(home, '.local', 'share', 'applications');
  const profile = join(home, '.tronbrowser');
  mkdirSync(apps, { recursive: true });
  mkdirSync(profile, { recursive: true });
  return { home, apps, profile };
}

function run(env: Env, args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('python3', [TRON_PWA, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: env.home,
      XDG_DATA_HOME: join(env.home, '.local', 'share'),
      TRONBROWSER_DATA: env.profile,
      TRONBROWSER_CLI: CLI,
    },
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? -1 };
}

const shortcut = (file: string) => (env: Env) => readFileSync(join(env.apps, file), 'utf8');
const execLines = (text: string) =>
  text
    .split('\n')
    .filter((l) => l.startsWith('Exec='))
    .map((l) => l.slice('Exec='.length));

/** A web app installed through TronBrowser, written the way the engine writes it. */
function writeTronApp(env: Env, opts: { engine?: string; withAction?: boolean } = {}): string {
  const engine = opts.engine ?? '/app/chromium/chrome';
  const file = `chrome-${APP_ID}-Default.desktop`;
  const base = `${engine} --user-data-dir=${env.profile} --profile-directory=Default --app-id=${APP_ID}`;
  const lines = [
    '[Desktop Entry]',
    'Version=1.0',
    'Type=Application',
    'Name=Excalidraw',
    `Exec=${base}`,
    `Icon=chrome-${APP_ID}-Default`,
    `StartupWMClass=crx_${APP_ID}`,
  ];
  if (opts.withAction) {
    lines.push(
      'Actions=New',
      '',
      '[Desktop Action New]',
      'Name=New board',
      `Exec=${base} --app-launch-url-for-shortcuts-menu-item=https://excalidraw.com/new`,
    );
  }
  writeFileSync(join(env.apps, file), `${lines.join('\n')}\n`);
  return file;
}

describe('tron pwa sync', () => {
  it('repoints a TronBrowser web app at the launcher, keeping its switches', () => {
    const env = setup();
    const file = writeTronApp(env);

    expect(run(env, ['sync']).status).toBe(0);

    const [exec] = execLines(shortcut(file)(env));
    // The launcher runs, not the engine — that is the whole fix.
    expect(exec.split(' ')[0]).toBe(CLI);
    // Everything that identifies WHICH app in WHICH profile has to survive, or
    // the icon opens the wrong thing (or a plain browser window).
    expect(exec).toContain(`--app-id=${APP_ID}`);
    expect(exec).toContain('--profile-directory=Default');
    expect(exec).toContain(`--user-data-dir=${env.profile}`);
    // Without a class matching StartupWMClass the window does not bind to its
    // taskbar entry: it shows up as a stray TronBrowser window.
    expect(exec).toContain(`--class=crx_${APP_ID}`);
  });

  it('rewrites shortcut-menu actions too, not just the main entry', () => {
    const env = setup();
    const file = writeTronApp(env, { withAction: true });

    run(env, ['sync']);

    const lines = execLines(shortcut(file)(env));
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.startsWith(CLI))).toBe(true);
    expect(lines[1]).toContain('--app-launch-url-for-shortcuts-menu-item=https://excalidraw.com/new');
  });

  it('leaves another browser\'s web app completely alone', () => {
    const env = setup();
    const file = `chrome-${OTHER_ID}-Default.desktop`;
    const original = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Google Docs',
      `Exec=/opt/google/chrome/google-chrome --profile-directory=Default --app-id=${OTHER_ID}`,
      '',
    ].join('\n');
    writeFileSync(join(env.apps, file), original);

    run(env, ['sync']);

    expect(shortcut(file)(env)).toBe(original);
  });

  it('is idempotent — a second sync changes nothing', () => {
    const env = setup();
    const file = writeTronApp(env);

    run(env, ['sync']);
    const once = shortcut(file)(env);
    const second = run(env, ['sync']);

    expect(shortcut(file)(env)).toBe(once);
    expect(second.stdout.trim()).toBe('');
  });

  it('re-repairs a shortcut the engine has rewritten underneath us', () => {
    // The engine rewrites these files whenever an app's manifest or icon
    // changes, putting its own path back and dropping our keys with it. That is
    // why sync runs on every launch instead of once at install.
    const env = setup();
    const file = writeTronApp(env);
    run(env, ['sync']);
    writeTronApp(env, { engine: '/usr/bin/ungoogled-chromium' });

    run(env, ['sync']);

    const [exec] = execLines(shortcut(file)(env));
    expect(exec.split(' ')[0]).toBe(CLI);
    // The engine it records is the one it just displaced, so revert still lands
    // somewhere launchable.
    run(env, ['revert']);
    expect(execLines(shortcut(file)(env))[0].split(' ')[0]).toBe('/usr/bin/ungoogled-chromium');
  });

  it('never records its own CLI as the engine to revert to', () => {
    // Syncing an already-synced shortcut reads an Exec that names the launcher.
    // Taking that as "the engine" would make revert a no-op and strand the
    // shortcut on a launcher that uninstall is about to delete.
    const env = setup();
    const file = writeTronApp(env);

    run(env, ['sync']);
    run(env, ['sync']);
    run(env, ['sync']);
    run(env, ['revert']);

    const [exec] = execLines(shortcut(file)(env));
    expect(exec.split(' ')[0]).toBe('/app/chromium/chrome');
    expect(exec).not.toContain(CLI);
  });

  it('handles a profile path containing spaces', () => {
    const env = setup();
    const profile = join(env.home, 'my profile');
    mkdirSync(profile, { recursive: true });
    const file = `chrome-${APP_ID}-Default.desktop`;
    writeFileSync(
      join(env.apps, file),
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Spaced',
        `Exec=/app/chromium/chrome "--user-data-dir=${profile}" --app-id=${APP_ID}`,
        '',
      ].join('\n'),
    );

    const result = spawnSync('python3', [TRON_PWA, 'sync'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: env.home,
        XDG_DATA_HOME: join(env.home, '.local', 'share'),
        TRONBROWSER_DATA: profile,
        TRONBROWSER_CLI: CLI,
      },
    });
    expect(result.status).toBe(0);

    const [exec] = execLines(shortcut(file)(env));
    expect(exec.split(' ')[0]).toBe(CLI);
    // Re-quoted, so the desktop still parses it as one argument.
    expect(exec).toContain(`"--user-data-dir=${profile}"`);
  });

  it('passes back the class the shortcut itself declares', () => {
    // Taskbar binding is StartupWMClass == the window's WM_CLASS. The launcher
    // stamps --class=TronBrowser on everything it starts, so the shortcut's own
    // declared class has to be handed back or the app window never binds.
    const env = setup();
    const file = `chrome-${APP_ID}-Default.desktop`;
    writeFileSync(
      join(env.apps, file),
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Renamed',
        `Exec=/app/chromium/chrome --user-data-dir=${env.profile} --app-id=${APP_ID}`,
        'StartupWMClass=some.other.Class',
        '',
      ].join('\n'),
    );

    run(env, ['sync']);

    expect(execLines(shortcut(file)(env))[0]).toContain('--class=some.other.Class');
  });

  it('keeps a --class the shortcut already had, and revert leaves it', () => {
    const env = setup();
    const file = `chrome-${APP_ID}-Default.desktop`;
    writeFileSync(
      join(env.apps, file),
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Classed',
        `Exec=/app/chromium/chrome --user-data-dir=${env.profile} --app-id=${APP_ID} --class=mine`,
        `StartupWMClass=crx_${APP_ID}`,
        '',
      ].join('\n'),
    );

    run(env, ['sync']);
    expect(execLines(shortcut(file)(env))[0]).toContain('--class=mine');
    expect(execLines(shortcut(file)(env))[0]).not.toContain(`--class=crx_${APP_ID}`);

    run(env, ['revert']);
    expect(execLines(shortcut(file)(env))[0]).toContain('--class=mine');
  });

  it('drops field codes so a file manager cannot pass a path through', () => {
    const env = setup();
    const file = `chrome-${APP_ID}-Default.desktop`;
    writeFileSync(
      join(env.apps, file),
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Fielded',
        `Exec=/app/chromium/chrome --user-data-dir=${env.profile} --app-id=${APP_ID} %U`,
        '',
      ].join('\n'),
    );

    run(env, ['sync']);

    expect(execLines(shortcut(file)(env))[0]).not.toContain('%U');
  });
});

describe('tron pwa list', () => {
  it('names the engine a broken shortcut still points at', () => {
    const env = setup();
    writeTronApp(env);

    const out = run(env, ['list']).stdout;

    expect(out).toContain('Excalidraw');
    expect(out).toContain('/app/chromium/chrome');
    expect(out).toContain('tron pwa sync');
  });

  it('says which shortcuts are not ours', () => {
    const env = setup();
    writeFileSync(
      join(env.apps, `chrome-${OTHER_ID}-Default.desktop`),
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Google Docs',
        `Exec=/opt/google/chrome/google-chrome --app-id=${OTHER_ID}`,
        '',
      ].join('\n'),
    );

    expect(run(env, ['list']).stdout).toContain('left alone');
  });
});

describe('the launcher runs the sync itself', () => {
  // A repair nobody invokes is not a fix. The engine rewrites these shortcuts
  // behind us, so the browser has to re-run this on every start — which means
  // the wiring in the shim is part of the fix, not an optimisation.
  it('repairs a broken shortcut on browser start', () => {
    const env = setup();
    const file = writeTronApp(env);

    // Stage the shim and the helper together: the shim resolves helpers
    // relative to its own directory.
    const bin = join(env.home, 'bin');
    mkdirSync(bin, { recursive: true });
    const shim = join(bin, 'tronbrowser');
    copyFileSync(join(HERE, '..', 'launcher', 'tronbrowser'), shim);
    copyFileSync(TRON_PWA, join(bin, 'tron-pwa'));
    chmodSync(shim, 0o755);
    chmodSync(join(bin, 'tron-pwa'), 0o755);

    // Named ungoogled-chromium so the shim's de-googled check stays quiet.
    const browser = join(bin, 'ungoogled-chromium');
    writeFileSync(
      browser,
      ['#!/bin/sh', 'if [ "${1:-}" = "--version" ]; then echo "Chromium 100.0.0.0"; fi', 'exit 0'].join('\n'),
      { mode: 0o755 },
    );

    const result = spawnSync('sh', [shim], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: env.home,
        XDG_DATA_HOME: join(env.home, '.local', 'share'),
        TRONBROWSER_BROWSER: browser,
        TRONBROWSER_DATA: env.profile,
        TRONBROWSER_CLI: CLI,
        TRONBROWSER_VERBOSE: '1',
      },
    });
    expect(result.status).toBe(0);

    expect(execLines(shortcut(file)(env))[0].split(' ')[0]).toBe(CLI);
  });
});

describe('tron pwa revert', () => {
  it('hands a shortcut back to the engine, class flag and all', () => {
    const env = setup();
    const file = writeTronApp(env);
    run(env, ['sync']);

    run(env, ['revert']);

    const text = shortcut(file)(env);
    const [exec] = execLines(text);
    expect(exec.split(' ')[0]).toBe('/app/chromium/chrome');
    expect(exec).not.toContain('--class=');
    expect(text).not.toContain('X-TronBrowser-Launcher');
  });
});
