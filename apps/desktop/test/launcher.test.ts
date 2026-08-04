// The launcher shim decides what Chromium runs and with which flags, and it is
// the one piece of TronBrowser with no compiler and no types behind it. These
// tests run the real script against a stub browser that records its argv, so a
// change to flag handling has to survive something before it ships.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = join(HERE, '..', 'launcher', 'tronbrowser');

type Run = { argv: string[]; stderr: string; home: string };

const homes: string[] = [];

/**
 * Run the launcher with a stub browser and return the argv it was handed.
 *
 * The script is copied somewhere else first, on purpose: it resolves helpers
 * relative to its own directory, and a copy has no tron-tor-helper beside it,
 * so the background Tor helper is skipped instead of binding a port under test.
 */
function run(args: string[], opts: { version?: string; home?: string; env?: Record<string, string> } = {}): Run {
  const home = opts.home ?? mkdtempSync(join(tmpdir(), 'tron-launcher-'));
  if (!opts.home) homes.push(home);

  const dir = join(home, 'bin');
  mkdirSync(dir, { recursive: true });
  const script = join(dir, 'tronbrowser');
  copyFileSync(LAUNCHER, script);
  chmodSync(script, 0o755);

  // Named "ungoogled-chromium" so the launcher's de-googled check stays quiet.
  const argvOut = join(home, 'argv.txt');
  const browser = join(dir, 'ungoogled-chromium');
  writeFileSync(
    browser,
    [
      '#!/bin/sh',
      `if [ "\${1:-}" = "--version" ]; then echo "${opts.version ?? 'Chromium 100.0.0.0'}"; exit 0; fi`,
      `: > "${argvOut}"`,
      `for a in "$@"; do printf '%s\\n' "$a" >> "${argvOut}"; done`,
      'exit 0',
    ].join('\n'),
    { mode: 0o755 },
  );

  // TRONBROWSER_VERBOSE keeps the launcher from routing the browser's stderr
  // into its log file, so the engine lines reach us here.
  const result = spawnSync('sh', [script, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: home,
      TRONBROWSER_BROWSER: browser,
      TRONBROWSER_DATA: join(home, 'profile'),
      TRONBROWSER_VERBOSE: '1',
      ...(opts.env ?? {}),
    },
  });
  if (result.status !== 0) {
    throw new Error(`launcher exited ${result.status}\n${result.stderr ?? ''}`);
  }

  return {
    argv: existsSync(argvOut) ? readFileSync(argvOut, 'utf8').split('\n').filter(Boolean) : [],
    stderr: result.stderr ?? '',
    home,
  };
}

const valueOf = (argv: string[], name: string): string[] =>
  argv.filter((a) => a.startsWith(`${name}=`)).map((a) => a.slice(name.length + 1));

afterEach(() => {
  homes.length = 0;
});

describe('launcher flags', () => {
  it('passes its own profile when the caller asks for nothing', () => {
    const { argv, home } = run([]);
    expect(valueOf(argv, '--user-data-dir')).toEqual([join(home, 'profile')]);
  });

  it('lets the caller replace a switch instead of duplicating it', () => {
    // Chromium honors the FIRST --user-data-dir, so a duplicate meant the
    // caller's was ignored and the default profile opened instead.
    const { argv } = run(['--user-data-dir=/tmp/tron-scratch']);
    expect(valueOf(argv, '--user-data-dir')).toEqual(['/tmp/tron-scratch']);
  });

  it('merges --enable-features rather than dropping its own', () => {
    const { argv } = run(['--enable-features=WebGPU']);
    const enabled = valueOf(argv, '--enable-features');
    expect(enabled).toHaveLength(1);
    expect(enabled[0]!.split(',')).toEqual(expect.arrayContaining(['EnableTabMuting', 'WebGPU']));
  });

  it('merges --disable-features, keeping the Manifest V2 kill switch off', () => {
    // Dropping ours here would stop every MV2 extension from loading.
    const { argv } = run(['--disable-features=Foo']);
    const disabled = valueOf(argv, '--disable-features');
    expect(disabled).toHaveLength(1);
    expect(disabled[0]!.split(',')).toEqual(
      expect.arrayContaining(['ExtensionManifestV2Disabled', 'Translate', 'Foo']),
    );
  });

  it('leaves URLs and other arguments alone', () => {
    const { argv } = run(['https://tronbrowser.dev', '--incognito']);
    expect(argv).toContain('https://tronbrowser.dev');
    expect(argv).toContain('--incognito');
  });
});

// --- Omnibox search engine ---------------------------------------------------
// The launcher is the only thing that can set Chromium's default search engine
// (no MV3 API for it, and chrome_settings_overrides isn't available on Linux),
// so the rules about when it may overwrite one live here.

const KAGI_URL = 'https://kagi.com/search?q={searchTerms}';

const prefsPath = (home: string) => join(home, 'profile', 'Default', 'Preferences');

/** The default_search_provider_data the launcher left in the profile. */
function dse(home: string): Record<string, string> {
  const p = prefsPath(home);
  if (!existsSync(p)) return {};
  const json = JSON.parse(readFileSync(p, 'utf8'));
  return json.default_search_provider_data?.template_url_data ?? {};
}

/** A profile that already has a search engine set, and a record of who set it. */
function seed(opts: { url?: string; marker?: string; legacyKagi?: boolean; want?: string }): string {
  const home = mkdtempSync(join(tmpdir(), 'tron-launcher-'));
  homes.push(home);
  const data = join(home, 'profile');
  mkdirSync(join(data, 'Default'), { recursive: true });
  if (opts.url) {
    writeFileSync(
      prefsPath(home),
      JSON.stringify({
        default_search_provider_data: { template_url_data: { short_name: 'Seeded', url: opts.url } },
        // A real profile has more than the one key; it must survive our write.
        bookmark_bar: { show_on_all_tabs: true },
      }),
    );
  }
  if (opts.legacyKagi) writeFileSync(join(data, '.tron-search-kagi'), '');
  if (opts.marker) writeFileSync(join(data, '.tron-search'), `${opts.marker}\n`);
  if (opts.want) writeFileSync(join(data, 'search-engine'), `${opts.want}\n`);
  return home;
}

describe('omnibox search engine', () => {
  it('defaults a fresh profile to an engine that works without an account', () => {
    // Kagi is subscription-only past its trial, so defaulting to it left a new
    // install unable to search at all — it just landed on a login wall.
    const { home } = run([]);
    expect(dse(home).url).toBe('https://duckduckgo.com/?q={searchTerms}');
  });

  it('never sets a suggestions_url', () => {
    // A suggest endpoint fires per keystroke in the address bar: it leaks the
    // query before you hit enter, and stalls typing when it is slow or 401s.
    const { home } = run([]);
    expect(dse(home)).not.toHaveProperty('suggestions_url');
  });

  it('honors the engine chosen with `tron search`', () => {
    const home = seed({ want: 'neosearch' });
    run([], { home });
    expect(dse(home).url).toBe('https://neosearch.org/?q={searchTerms}');
  });

  it('falls back and says so when the chosen engine is unknown', () => {
    const home = seed({ want: 'notanengine' });
    const { stderr } = run([], { home });
    expect(stderr).toContain("unknown search engine 'notanengine'");
    expect(dse(home).url).toBe('https://duckduckgo.com/?q={searchTerms}');
  });

  it('repairs a profile it had previously pinned to Kagi', () => {
    // The actual bug: everyone who installed before this had Kagi written into
    // their profile by us, and nothing moved them off it.
    const home = seed({ url: KAGI_URL, legacyKagi: true });
    run([], { home });
    expect(dse(home).url).toBe('https://duckduckgo.com/?q={searchTerms}');
  });

  it('leaves an engine the user picked themselves alone', () => {
    // We may correct our own default. We may not overwrite a deliberate choice.
    const chosen = 'https://www.google.com/search?q={searchTerms}';
    const home = seed({ url: chosen, legacyKagi: true });
    run([], { home });
    expect(dse(home).url).toBe(chosen);
  });

  it('lets an explicit `tron search` override even a user-set engine', () => {
    const home = seed({ url: 'https://www.google.com/search?q={searchTerms}', want: 'kagi' });
    run([], { home });
    expect(dse(home).url).toBe(KAGI_URL);
  });

  it('stops touching the setting once it has applied it', () => {
    // Second launch must not re-apply, or changing the engine in
    // chrome://settings/search would be undone on every start.
    const first = run([]);
    const chosen = 'https://www.startpage.com/sp/search?q={searchTerms}';
    writeFileSync(
      prefsPath(first.home),
      JSON.stringify({ default_search_provider_data: { template_url_data: { url: chosen } } }),
    );
    run([], { home: first.home });
    expect(dse(first.home).url).toBe(chosen);
  });

  it('keeps the rest of Preferences when it rewrites the engine', () => {
    const home = seed({ url: KAGI_URL, legacyKagi: true });
    run([], { home });
    const json = JSON.parse(readFileSync(prefsPath(home), 'utf8'));
    expect(json.bookmark_bar?.show_on_all_tabs).toBe(true);
  });
});

// --- GPU backend -------------------------------------------------------------
// We do not choose the backend — the flatpak wrapper forces Vulkan on and some
// drivers take the GPU process down with it. These pin the escape hatch: what
// each mode puts on the command line, and that an unknown mode is not obeyed.

describe('GPU backend', () => {
  const gpuHome = (mode: string): string => {
    const home = mkdtempSync(join(tmpdir(), 'tron-launcher-'));
    homes.push(home);
    mkdirSync(join(home, 'profile'), { recursive: true });
    writeFileSync(join(home, 'profile', 'gpu-mode'), mode + '\n');
    return home;
  };

  it('leaves the backend alone by default', () => {
    const { argv } = run([]);
    expect(argv).not.toContain('--disable-gpu');
    expect(valueOf(argv, '--disable-features')[0]).not.toContain('Vulkan');
  });

  it("'safe' disables Vulkan without giving up acceleration", () => {
    const { argv } = run([], { home: gpuHome('safe') });
    expect(valueOf(argv, '--disable-features')[0]!.split(',')).toContain('Vulkan');
    expect(argv).not.toContain('--disable-gpu');
  });

  it("'safe' keeps the Manifest V2 kill switch off too", () => {
    // It shares one comma-separated list; appending must not replace it.
    const { argv } = run([], { home: gpuHome('safe') });
    expect(valueOf(argv, '--disable-features')[0]!.split(',')).toEqual(
      expect.arrayContaining(['ExtensionManifestV2Disabled', 'Translate', 'Vulkan']),
    );
  });

  it("'off' drops the GPU process and its compositing", () => {
    const { argv } = run([], { home: gpuHome('off') });
    expect(argv).toContain('--disable-gpu');
    expect(argv).toContain('--disable-gpu-compositing');
  });

  it('falls back to on, and says so, when the mode is not one we know', () => {
    const { argv, stderr } = run([], { home: gpuHome('turbo') });
    expect(stderr).toContain("unknown GPU mode 'turbo'");
    expect(argv).not.toContain('--disable-gpu');
    expect(valueOf(argv, '--disable-features')[0]).not.toContain('Vulkan');
  });

  it('lets TRONBROWSER_GPU override the stored mode', () => {
    const home = gpuHome('off');
    const { argv } = run([], { home, env: { TRONBROWSER_GPU: 'safe' } });
    expect(argv).not.toContain('--disable-gpu');
    expect(valueOf(argv, '--disable-features')[0]!.split(',')).toContain('Vulkan');
  });
});

// --- Damaged profile ---------------------------------------------------------
// Three blocks in the launcher edit Chromium's JSON state files. Every one of
// them used to do `except Exception: d = {}` and then write the result — so a
// file that failed to parse was REPLACED by a stub holding only the key that
// block cared about. Preferences is the whole profile, which made that a silent
// factory reset, and the usual reason it failed to parse was the non-atomic
// write the same block did on the previous launch. These tests pin the rule:
// a state file we cannot read is a file we do not touch.

const localStatePath = (home: string) => join(home, 'profile', 'Local State');

/** A profile whose JSON state files are present but corrupt. */
function seedCorrupt(which: 'prefs' | 'localstate'): { home: string; path: string } {
  const home = mkdtempSync(join(tmpdir(), 'tron-launcher-'));
  homes.push(home);
  const path = which === 'prefs' ? prefsPath(home) : localStatePath(home);
  mkdirSync(dirname(path), { recursive: true });
  // What a truncated write leaves behind: valid JSON's opening, then nothing.
  writeFileSync(path, '{"default_search_provider_data": {"template_ur');
  return { home, path };
}

describe('damaged profile', () => {
  it('leaves an unparseable Preferences exactly as it found it', () => {
    const { home, path } = seedCorrupt('prefs');
    const before = readFileSync(path, 'utf8');
    run([], { home });
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('leaves an unparseable Local State exactly as it found it', () => {
    const { home, path } = seedCorrupt('localstate');
    const before = readFileSync(path, 'utf8');
    run([], { home });
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('says which file it refused to touch, rather than failing silently', () => {
    const { home } = seedCorrupt('prefs');
    const { stderr } = run([], { home });
    expect(stderr).toContain('did not parse');
  });

  it('still launches the browser when a state file is unreadable', () => {
    // Refusing to write must not become refusing to start.
    const { home } = seedCorrupt('prefs');
    const { argv } = run([], { home });
    expect(valueOf(argv, '--user-data-dir')).toEqual([join(home, 'profile')]);
  });

  it('keeps unrelated settings when it sets the startup page', () => {
    // The restore_on_startup block rewrites the whole file to change one key.
    const home = mkdtempSync(join(tmpdir(), 'tron-launcher-'));
    homes.push(home);
    const path = prefsPath(home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ bookmark_bar: { show_on_all_tabs: true }, extensions: { settings: { abc: 1 } } }));
    run([], { home });
    const json = JSON.parse(readFileSync(path, 'utf8'));
    expect(json.session?.restore_on_startup).toBe(5);
    expect(json.bookmark_bar?.show_on_all_tabs).toBe(true);
    expect(json.extensions?.settings?.abc).toBe(1);
  });
});

describe('engine reporting', () => {
  it('names the engine it is about to run', () => {
    const { stderr } = run([], { version: 'Chromium 141.0.0.0' });
    expect(stderr).toContain('TronBrowser: engine Chromium 141.0.0.0');
  });

  it('says so when the engine changed underneath it', () => {
    // The case this exists for: a Flatpak updates itself overnight and the
    // browser feels different, with nothing in TronBrowser's history to blame.
    const first = run([], { version: 'Chromium 141.0.0.0' });
    expect(first.stderr).not.toContain('CHANGED');

    const second = run([], { version: 'Chromium 149.0.0.0', home: first.home });
    expect(second.stderr).toContain('the browser engine CHANGED since your last launch');
    expect(second.stderr).toContain('was: Chromium 141.0.0.0');
    expect(second.stderr).toContain('now: Chromium 149.0.0.0');
  });

  it('stays quiet when the engine is the same as last time', () => {
    const first = run([], { version: 'Chromium 141.0.0.0' });
    const second = run([], { version: 'Chromium 141.0.0.0', home: first.home });
    expect(second.stderr).not.toContain('CHANGED');
  });
});
