/**
 * @tronbrowser/sdk — public TypeScript/JavaScript SDK for TronBrowser
 * automation (PRD M3.4).
 *
 *   import { tron } from '@tronbrowser/sdk';
 *   const browser = await tron.launch({ headless: true });
 *   const page = await browser.newPage();
 *   await page.goto('https://example.com/contact');
 *   const snap = await page.snapshot();
 *   await browser.close();
 *
 * Run scripts with `tron run ./script.ts` (or .js), which provides the managed
 * browser engine the SDK drives.
 */
export const PACKAGE_NAME = '@tronbrowser/sdk' as const;

export { Browser, type LaunchOptions } from './browser.js';
export { Page } from './page.js';
export type { SdkDeps, LaunchArgs } from './deps.js';

// Re-export the shared automation types so scripts can annotate results.
export type {
  AgentSnapshot,
  SnapshotElement,
  AutomationTab,
  FieldSpec,
} from '@tronbrowser/browser-core';

// Analyze types (PRD M3.5) for page.analyze()/step()/runTask().
export type {
  AnalyzeResult,
  AnalyzeOptions,
  PlannedAction,
  DetectedForm,
  FormFieldMapping,
} from '@tronbrowser/agent-runtime';

import { Browser, type LaunchOptions } from './browser.js';
import type { SdkDeps } from './deps.js';

/** The public entrypoint: `tron.launch(...)`. */
export const tron = {
  launch(options: LaunchOptions = {}, deps?: SdkDeps): Promise<Browser> {
    return deps ? Browser.launch(options, deps) : Browser.launch(options);
  },
};
