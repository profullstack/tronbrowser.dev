// Flat ESLint config for the whole pnpm workspace (apps/*, packages/*, services/*).
// One config, ESLint v9 flat format — avoids 18+ duplicate per-package configs.
// Each package's `lint` script runs `eslint <its dir>` against this root config.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    // Build output and vendored/fetched code never gets linted.
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/coverage/**',
      '**/.expo/**',
      '**/node_modules/**',
      'apps/desktop/chromium/**',
      'apps/desktop/extensions/ublock-origin/**', // fetched at build time, GPL, not vendored
      'pnpm-lock.yaml',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: c.files ?? ['**/*.{ts,mts,cts,tsx}'] })),

  // Plain-JS files (no type info) still get the underscore-prefix convention
  // used throughout this repo for intentionally-discarded destructured values
  // (e.g. `const { a: _a, ...rest } = obj`). TS files get the equivalent via
  // @typescript-eslint/no-unused-vars below.
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    rules: {
      'no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // --- Default: Node-targeted TypeScript (packages/*, services/*, most apps/*) ---
  {
    files: ['**/*.{ts,mts,cts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // The codebase leans on `any` in a handful of intentionally-loose spots
      // (Hono context params, third-party JSON payloads). Warn, don't block CI.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },

  // --- Plain Node scripts (scripts/*.mjs, *.config.js at package roots) ---
  {
    files: ['scripts/**/*.{js,mjs,cjs}', '**/*.config.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // --- Browser extension content (apps/desktop/extensions/**, apps/extensions/public/**) ---
  // MV3 extension context: browser globals + the `chrome` extension API.
  {
    files: [
      'apps/desktop/extensions/**/*.js',
      'apps/extensions/**/*.js',
    ],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, chrome: 'readonly' },
    },
  },

  // --- Plain browser JS served as static assets (apps/web/public/**) ---
  // Some of these files (feeds.js, settings-sections.js) are shared verbatim
  // with the ai-sidebar extension, so `chrome` needs to be available here too.
  {
    files: ['apps/web/public/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, chrome: 'readonly' },
    },
  },

  // Test files: vitest globals (describe/it/expect are imported explicitly in
  // this repo, but keep the env available for any that don't).
  {
    files: ['**/*.test.{ts,js}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);