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

// Snapshots and ref actions (PRD M3.2).
export * from './cdp-client.js';
export * from './snapshot-script.js';
export * from './action-script.js';
export * from './page-target.js';
export * from './page.js';

// Headless one-shot, extraction, and capture (PRD M3.3).
export * from './extract-script.js';
export * from './capture.js';

// Trace bundle format (PRD M3.7).
export * from './trace.js';
