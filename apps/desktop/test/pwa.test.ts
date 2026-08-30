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

describe('Flatpak flextop exports', () => {
  // What a Flathub TronBrowser actually produces, and what the first version of
  // this helper missed entirely: the filename does not start with chrome-, the
  // Exec is a `flatpak run` wrapper, and there is no --user-data-dir at all --
  // so the shortcut opens the Flatpak's own default profile, where the app is
  // not installed, and the browser exits a few seconds after starting.
  const FLATPAK = 'io.github.ungoogled_software.ungoogled_chromium';
  const flextopName = `${FLATPAK}.flextop.chrome-${APP_ID}-Default.desktop`;

  function writeFlextop(env: Env, opts: { installed?: boolean } = {}): string {
    if (opts.installed !== false) {
      mkdirSync(join(env.profile, 'Default', 'Web Applications', 'Manifest Resources', APP_ID), {
        recursive: true,
      });
    }
    writeFileSync(
      join(env.apps, flextopName),
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Reeleel',
        `Exec=/usr/bin/flatpak run --branch=stable --arch=x86_64 --command=/app/bin/chromium ${FLATPAK} --profile-directory=Default --app-id=${APP_ID}`,
        `StartupWMClass=crx_${APP_ID}`,
        '',
      ].join('\n'),
    );
    return flextopName;
  }

  it('finds a shortcut whose filename does not start with chrome-', () => {
    const env = setup();
    const file = writeFlextop(env);

    run(env, ['sync']);

    expect(execLines(shortcut(file)(env))[0].split(' ')[0]).toBe(CLI);
  });

  it('claims it by the app being installed in the profile, with no --user-data-dir to go on', () => {
    const env = setup();
    writeFlextop(env);

    expect(run(env, ['list']).stdout).toContain('Reeleel');
    expect(run(env, ['list']).stdout).not.toContain('left alone');
  });

  it('fills in the profile the app is actually installed in', () => {
    const env = setup();
    const file = writeFlextop(env);

    run(env, ['sync']);

    // Without this the shortcut opens the browser's default profile, which is
    // the entire bug: right browser, wrong profile, no such app, exit.
    expect(execLines(shortcut(file)(env))[0]).toContain(`--user-data-dir=${env.profile}`);
  });

  it('drops the flatpak wrapper tokens instead of forwarding them to the CLI', () => {
    const env = setup();
    const file = writeFlextop(env);

    run(env, ['sync']);

    // `run` is a tron subcommand. Forwarding it would run a script, not a browser.
    const [exec] = execLines(shortcut(file)(env));
    expect(exec).not.toContain(' run ');
    expect(exec).not.toContain('--branch=');
    expect(exec).not.toContain('--command=');
    expect(exec).not.toContain(FLATPAK + ' ');
  });

  it('restores the flatpak wrapper exactly on revert', () => {
    const env = setup();
    const file = writeFlextop(env);
    const before = execLines(shortcut(file)(env))[0];

    run(env, ['sync']);
    run(env, ['revert']);

    // Rebuilding this line is impossible once the wrapper tokens are dropped,
    // so it has to have been recorded verbatim.
    expect(execLines(shortcut(file)(env))[0]).toBe(before);
  });

  it('leaves a flextop app that is NOT in our profile alone', () => {
    const env = setup();
    const file = writeFlextop(env, { installed: false });
    const before = shortcut(file)(env);

    run(env, ['sync']);

    expect(shortcut(file)(env)).toBe(before);
  });
});

describe('single-quoted Exec values', () => {
  // Verbatim from a real Flathub install. The desktop-entry spec defines only
  // double quotes, but GLib -- which is what actually launches these -- honours
  // single quotes, so writers use them. Parsed to the spec, every argument here
  // is a literal token with an apostrophe on the front, so every switch test
  // fails and the file reads as "not a web app". That is how eleven working
  // shortcuts stayed invisible to two releases of this helper.
  const REAL_EXEC =
    "flatpak 'run' '--command=/app/bin/chromium' " +
    "'io.github.ungoogled_software.ungoogled_chromium' " +
    `'--user-data-dir=PROFILE' '--profile-directory=Default' '--app-id=${APP_ID}'`;

  function writeReal(env: Env): string {
    const file = `io.github.ungoogled_software.ungoogled_chromium.flextop.chrome-${APP_ID}-Default.desktop`;
    writeFileSync(
      join(env.apps, file),
      [
        '[Desktop Entry]',
        'Version=1.0',
        'Terminal=false',
        'Type=Application',
        'Name=Sulata Note',
        `Exec=${REAL_EXEC.replace('PROFILE', env.profile)}`,
        `Icon=chrome-${APP_ID}-Default`,
        `StartupWMClass=crx_${APP_ID}`,
        'X-Flatpak-Part-Of=io.github.ungoogled_software.ungoogled_chromium',
        'TryExec=/var/lib/flatpak/exports/bin/io.github.ungoogled_software.ungoogled_chromium',
        '',
      ].join('\n'),
    );
    return file;
  }

  it('recognises a single-quoted --app-id as a web app at all', () => {
    const env = setup();
    writeReal(env);

    expect(run(env, ['list']).stdout).toContain('Sulata Note');
  });

  it('rewrites it, keeping the app and profile and dropping the flatpak wrapper', () => {
    const env = setup();
    const file = writeReal(env);

    run(env, ['sync']);

    const [exec] = execLines(shortcut(file)(env));
    expect(exec.split(' ')[0]).toBe(CLI);
    expect(exec).toContain(`--app-id=${APP_ID}`);
    expect(exec).toContain(`--user-data-dir=${env.profile}`);
    expect(exec).toContain('--profile-directory=Default');
    expect(exec).not.toContain('--command=');
    expect(exec).not.toContain("'");
  });

  it('reverts byte-for-byte, single quotes and all', () => {
    const env = setup();
    const file = writeReal(env);
    const before = shortcut(file)(env);

    run(env, ['sync']);
    run(env, ['revert']);

    expect(shortcut(file)(env)).toBe(before);
  });

  it('still parses double quotes and backslash escapes', () => {
    const env = setup();
    const profile = join(env.home, 'a b');
    mkdirSync(profile, { recursive: true });
    const file = `chrome-${APP_ID}-Default.desktop`;
    writeFileSync(
      join(env.apps, file),
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Mixed',
        `Exec=/app/chromium/chrome "--user-data-dir=${profile}" '--app-id=${APP_ID}'`,
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
    expect(exec).toContain(`"--user-data-dir=${profile}"`);
    expect(exec).toContain(`--app-id=${APP_ID}`);
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
