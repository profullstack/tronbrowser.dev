/**
 * Thin process launcher for the TronBrowser binary. Desktop-specific glue —
 * isolated here per the PRD rule "Desktop-specific code stays isolated".
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { buildLaunchFlags, torEnabled, type LaunchOptions } from './chromium-flags.js';
import { resolveBinaryPath, type DesktopPlatform } from './binary.js';
import { TorDaemon, type StartTorOptions } from './tor.js';

export interface LaunchConfig extends LaunchOptions {
  /** Directory containing the built binary (chromium/out/<build>). */
  outDir: string;
  platform?: DesktopPlatform;
  /** Initial URLs to open. */
  urls?: string[];
  /** Directory holding a bundled `tor` binary; falls back to PATH when unset. */
  torBundledDir?: string;
  /** Tor's working directory (descriptor cache, etc.). */
  torDataDir?: string;
  /** Called with 0..100 as Tor bootstraps, for progress UI. */
  onTorProgress?: (pct: number) => void;
}

/**
 * Resolves the URLs to open. No forced startup URL — a fresh launch opens the
 * New Tab page (the ai-sidebar feed) via the browser's startup preference, which
 * goes through the new-tab path that honors `chrome_url_overrides`. Navigating to
 * chrome://newtab/ or a chrome-extension:// page from the command line does NOT
 * (default NTP / blocked by Chromium), so we never inject one here.
 */
export function resolveStartUrls(urls?: string[]): string[] {
  return urls && urls.length > 0 ? urls : [];
}

/** Spawns the browser process with the resolved flags + start URLs. */
function spawnBrowser(config: LaunchConfig): ChildProcess {
  const binary = resolveBinaryPath(config.outDir, config.platform);
  const flags = buildLaunchFlags(config);
  const args = [...flags, ...resolveStartUrls(config.urls)];
  return spawn(binary, args, { stdio: 'inherit' });
}

/**
 * Launches the browser process with privacy flags enforced.
 *
 * Synchronous, non-Tor path. For Tor mode use {@link launchWithTor}, which must
 * await the daemon bootstrap before spawning the browser.
 */
export function launch(config: LaunchConfig): ChildProcess {
  if (torEnabled(config)) {
    throw new Error('Tor mode requires launchWithTor() (async bootstrap).');
  }
  return spawnBrowser(config);
}

/**
 * Tor path: starts the local Tor daemon, waits for the circuit to bootstrap,
 * then launches the browser routed through it. The daemon is stopped when the
 * browser exits. Resolves with the browser process.
 */
export async function launchWithTor(config: LaunchConfig): Promise<ChildProcess> {
  // Only forward keys that are actually set — `exactOptionalPropertyTypes`
  // rejects explicit `undefined` on optional properties.
  const torOpts: StartTorOptions = {};
  if (config.torSocksPort !== undefined) torOpts.socksPort = config.torSocksPort;
  if (config.torDataDir !== undefined) torOpts.dataDir = config.torDataDir;
  if (config.torBundledDir !== undefined) torOpts.bundledDir = config.torBundledDir;
  if (config.platform !== undefined) torOpts.platform = config.platform;
  if (config.onTorProgress !== undefined) torOpts.onProgress = config.onTorProgress;

  const daemon = new TorDaemon(torOpts);

  await daemon.start();

  const browser = spawnBrowser({ ...config, tor: true });
  browser.once('exit', () => daemon.stop());
  return browser;
}
