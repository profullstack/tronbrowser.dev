/**
 * @tronbrowser/browser-core
 * Browser abstraction over the Chromium fork. Desktop-specific glue stays in
 * apps/desktop; this package holds portable contracts only.
 */

export const PACKAGE_NAME = '@tronbrowser/browser-core' as const;

/** Capabilities that must be preserved from upstream Chromium (PRD §Desktop). */
export const PRESERVED_CAPABILITIES = [
  'chrome-extensions',
  'profiles',
  'bookmarks',
  'downloads',
  'history',
  'pwas',
  'devtools',
] as const;
export type PreservedCapability = (typeof PRESERVED_CAPABILITIES)[number];

export interface Tab {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

export interface Profile {
  id: string;
  name: string;
}

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  folderId?: string;
}

export interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: string;
}

/** Portable surface the desktop shell implements against the Chromium fork. */
export interface BrowserCore {
  listTabs(): Promise<Tab[]>;
  openTab(url: string): Promise<Tab>;
  closeTab(id: string): Promise<void>;
  listProfiles(): Promise<Profile[]>;
  listBookmarks(): Promise<Bookmark[]>;
  queryHistory(query: string): Promise<HistoryEntry[]>;
}
