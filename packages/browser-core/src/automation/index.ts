/**
 * @tronbrowser/browser-core — automation (managed sessions, PRD M3.1).
 *
 * Portable contracts and pure helpers for CDP-driven managed browser sessions.
 * Desktop-specific process/IO glue stays in apps/desktop; this module holds the
 * schema and logic the shell engine and future TS CDP client both conform to.
 */
export * from './types.js';
export * from './cdp.js';
export * from './descriptor.js';
