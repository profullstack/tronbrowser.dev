/**
 * @tronbrowser/desktop
 * Desktop shell for the TronBrowser Chromium fork.
 *
 * This package is the isolated, desktop-specific integration layer: it builds
 * the fork (see `chromium/`), resolves the built binary, and launches it with
 * the privacy guarantees from the PRD enforced at runtime.
 */

export const PACKAGE_NAME = '@tronbrowser/desktop' as const;

export * from './chromium-flags.js';
export * from './binary.js';
export * from './launcher.js';
