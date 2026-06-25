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
 * Resolves the URLs to open. No forced startup URL — a fresh launch opens the
 * New Tab page (the ai-sidebar feed) via the browser's startup preference, which
 * goes through the new-tab path that honors `chrome_url_overrides`. Navigating to
 * chrome://newtab/ or a chrome-extension:// page from the command line does NOT
 * (default NTP / blocked by Chromium), so we never inject one here.
 */
export function resolveStartUrls(urls?: string[]): string[] {
  return urls && urls.length > 0 ? urls : [];
}

/** Launches the browser process with privacy flags enforced. */
export function launch(config: LaunchConfig): ChildProcess {
  const binary = resolveBinaryPath(config.outDir, config.platform);
  const flags = buildLaunchFlags(config);
  const args = [...flags, ...resolveStartUrls(config.urls)];
  return spawn(binary, args, { stdio: 'inherit' });
}
