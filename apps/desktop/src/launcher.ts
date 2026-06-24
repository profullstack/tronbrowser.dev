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

/** Launches the browser process with privacy flags enforced. */
export function launch(config: LaunchConfig): ChildProcess {
  const binary = resolveBinaryPath(config.outDir, config.platform);
  const flags = buildLaunchFlags(config);
  const args = [...flags, ...(config.urls ?? [])];
  return spawn(binary, args, { stdio: 'inherit' });
}
