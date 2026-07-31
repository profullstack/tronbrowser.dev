/**
 * @tronbrowser/extensions
 * The TronBrowser extension store frontend (static pages in ./public, served at
 * tronbrowser.dev/store). All dynamic behaviour lives in the API at /api/store
 * (services/api/src/store). This package is a static asset bundle; the export
 * below exists only so the workspace's `pnpm -r build/typecheck` is happy.
 *
 * See ../../docs/extension-store.md
 */
export const PACKAGE_NAME = '@tronbrowser/extensions' as const;
export const STORE_BASE_PATH = '/store' as const;
