/**
 * Resolve which page target's DevTools WebSocket to drive (PRD M3.2).
 *
 * A managed session can have several page targets; snapshot/click/fill act on
 * the "current" one — the descriptor's active tab when present, else the first
 * page — matching how `tron browser tabs` marks the current tab.
 */
import type { CdpTarget } from './types.js';

/** Page target chosen to act on: the active tab if present, else the first page. */
export function selectPageTarget(
  targets: readonly CdpTarget[],
  activeTabId?: string,
): CdpTarget | undefined {
  const pages = targets.filter((t) => t.type === 'page');
  if (activeTabId !== undefined) {
    const active = pages.find((t) => t.id === activeTabId);
    if (active) return active;
  }
  return pages[0];
}

/** The page WebSocket URL to attach to, or throw a clear error if none. */
export function resolvePageWsUrl(
  targets: readonly CdpTarget[],
  activeTabId?: string,
): string {
  const target = selectPageTarget(targets, activeTabId);
  if (!target) throw new Error('No page target in the managed session');
  if (!target.webSocketDebuggerUrl) {
    throw new Error(`Page target ${target.id} has no webSocketDebuggerUrl`);
  }
  return target.webSocketDebuggerUrl;
}
