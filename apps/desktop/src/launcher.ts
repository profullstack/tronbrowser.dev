/**
 * Thin process launcher for the TronBrowser binary. Desktop-specific glue —
 * isolated here per the PRD rule "Desktop-specific code stays isolated".
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { buildLaunchFlags, type LaunchOptions } from './chromium-flags.js';
import { resolveBinaryPath, type DesktopPlatform } from './binary.js';

export interface LaunchConfig extends LaunchOptions {
  /** Directory containing the built binary (chromium/out/<build>). */
  outDir: string;
  platform?: DesktopPlatform;
  /** Initial URLs to open. */
  urls?: string[];
}

/**
 * The page shown on a fresh launch when no URLs are given: the TronBrowser feed
 * (the ai-sidebar new-tab page). chrome://newtab/ from the command line shows
 * Chromium's DEFAULT NTP — the `chrome_url_overrides` newtab override only applies
 * to UI-created tabs — so we open the extension's page directly. The extension ID
 * is fixed by the manifest "key".
 */
export const DEFAULT_START_URL = 'chrome-extension://blkabajacljkbmjnffffobbnoipcckah/newtab.html';

/** Resolves the URLs to open, defaulting to the feed when none are supplied. */
export function resolveStartUrls(urls?: string[]): string[] {
  return urls && urls.length > 0 ? urls : [DEFAULT_START_URL];
}

/** Launches the browser process with privacy flags enforced. */
export function launch(config: LaunchConfig): ChildProcess {
  const binary = resolveBinaryPath(config.outDir, config.platform);
  const flags = buildLaunchFlags(config);
  const args = [...flags, ...resolveStartUrls(config.urls)];
  return spawn(binary, args, { stdio: 'inherit' });
}
