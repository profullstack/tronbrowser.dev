/**
 * CDP DevTools HTTP-endpoint helpers.
 *
 * M3.1 drives managed sessions through the DevTools HTTP JSON endpoints
 * (`/json/version`, `/json/list`, `/json/new`, `/json/close`, `/json/activate`)
 * — enough for launch/status/tabs/close/open without a WebSocket, keeping the
 * milestone dependency-free. The URL builders below are the shared contract the
 * shell engine mirrors with `curl`.
 */
import type { AutomationTab, CdpTarget } from './types.js';

/** A loopback DevTools endpoint. */
export interface CdpEndpoint {
  host: string;
  port: number;
}

/** Base `http://host:port` origin for the DevTools endpoint. */
export function cdpBaseUrl(endpoint: CdpEndpoint): string {
  return `http://${endpoint.host}:${endpoint.port}`;
}

/** Browser/version info (also carries the browser-level `webSocketDebuggerUrl`). */
export function cdpVersionUrl(endpoint: CdpEndpoint): string {
  return `${cdpBaseUrl(endpoint)}/json/version`;
}

/** List of open targets (tabs, workers, ...). */
export function cdpListUrl(endpoint: CdpEndpoint): string {
  return `${cdpBaseUrl(endpoint)}/json/list`;
}

/**
 * Open a new tab. Chromium reads the raw URL after `?` and URL-decodes it, so
 * `url` must be a well-formed absolute URL. Modern Chromium requires this to be
 * issued as an HTTP `PUT`.
 */
export function cdpNewTabUrl(endpoint: CdpEndpoint, url: string): string {
  return `${cdpBaseUrl(endpoint)}/json/new?${url}`;
}

/** Close the target with the given id. */
export function cdpCloseTabUrl(endpoint: CdpEndpoint, targetId: string): string {
  return `${cdpBaseUrl(endpoint)}/json/close/${targetId}`;
}

/** Bring the target with the given id to the foreground. */
export function cdpActivateTabUrl(endpoint: CdpEndpoint, targetId: string): string {
  return `${cdpBaseUrl(endpoint)}/json/activate/${targetId}`;
}

/**
 * Normalize raw CDP targets into page tabs, marking the current one.
 *
 * Only `type === 'page'` targets are surfaced (background/service-worker and
 * devtools targets are hidden). The current tab is the descriptor's active tab
 * when it is still present, otherwise the first page — so `tron browser tabs`
 * can always identify a current tab (PRD M3.1 acceptance).
 */
export function mapTargetsToTabs(
  targets: readonly CdpTarget[],
  activeTabId?: string,
): AutomationTab[] {
  const pages = targets.filter((t) => t.type === 'page');
  const activeIsPresent =
    activeTabId !== undefined && pages.some((t) => t.id === activeTabId);
  return pages.map((t, index) => ({
    id: t.id,
    url: t.url ?? '',
    title: t.title ?? '',
    current: activeIsPresent ? t.id === activeTabId : index === 0,
  }));
}

/** The current tab from a normalized list (the marked one, else the first). */
export function selectCurrentTab(
  tabs: readonly AutomationTab[],
): AutomationTab | undefined {
  return tabs.find((t) => t.current) ?? tabs[0];
}
