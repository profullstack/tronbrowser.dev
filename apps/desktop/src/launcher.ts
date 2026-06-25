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
 * The page shown on a fresh launch when no URLs are given: the extension-
 * overridden New Tab page (the TronBrowser feed). Without an explicit startup
 * URL, Chromium opens a blank/default page, so the `chrome_url_overrides` newtab
 * feed only appears once the user opens a *new* tab — we open it on startup.
 */
export const DEFAULT_START_URL = 'chrome://newtab/';

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
