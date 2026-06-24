/**
 * Resolves the path to the built TronBrowser (Chromium fork) binary per platform.
 * The binary is produced by `chromium/scripts/build.sh` into `chromium/out`.
 */

import { join } from 'node:path';

export type DesktopPlatform = 'linux' | 'darwin' | 'win32';

const BINARY_RELATIVE: Record<DesktopPlatform, string> = {
  linux: 'tronbrowser',
  darwin: 'TronBrowser.app/Contents/MacOS/TronBrowser',
  win32: 'tronbrowser.exe',
};

/** Returns the platform-specific path of the built browser binary. */
export function resolveBinaryPath(
  outDir: string,
  platform: DesktopPlatform = process.platform as DesktopPlatform,
): string {
  const rel = BINARY_RELATIVE[platform];
  if (!rel) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  return join(outDir, rel);
}
