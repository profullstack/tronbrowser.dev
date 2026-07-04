/**
 * Managed browser-session contracts (PRD M3.1).
 *
 * These types are the portable spec shared by the shell session engine
 * (`apps/desktop/launcher/tron-session`, the running implementation today) and
 * the future TypeScript CDP client (M3.2+). The descriptor's
 * `webSocketDebuggerUrl` is the attach point programmatic tooling uses to drive
 * a session the CLI launched.
 */

/** A raw DevTools target as returned by the CDP `/json/list` endpoint. */
export interface CdpTarget {
  id: string;
  type: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

/** A page tab, normalized for humans and agents. */
export interface AutomationTab {
  id: string;
  url: string;
  title: string;
  /** The tab ref-less actions target: the descriptor's active tab, else the first page. */
  current: boolean;
}

/**
 * On-disk descriptor for a managed session, written by `tron browser launch`
 * and read by `status`/`tabs`/`use`/`current`/`close`/`open`.
 */
export interface SessionDescriptor {
  /** Schema version so later tooling can migrate older descriptors. */
  version: 1;
  /** PID of the launched managed browser process. */
  pid: number;
  /** Loopback host the DevTools endpoint binds to. Always 127.0.0.1 for M3.1. */
  host: string;
  /** Remote-debugging port. */
  port: number;
  /** Absolute path to the Chromium user-data-dir backing this session. */
  profileDir: string;
  /** Profile label: "default", "ephemeral", or a caller-supplied name. */
  profileName: string;
  /** Whether the session runs headless. */
  headless: boolean;
  /** Ephemeral profiles are deleted on close. */
  ephemeral: boolean;
  /** ISO-8601 launch timestamp. */
  createdAt: string;
  /** CDP browser-level WebSocket endpoint (attach point for M3.2+). */
  webSocketDebuggerUrl?: string;
  /** Target id of the tab subsequent ref-less actions target. */
  activeTabId?: string;
}

/** Liveness of a managed session, derived from the descriptor plus runtime checks. */
export type SessionState =
  | 'running' // descriptor present, process alive, DevTools endpoint reachable
  | 'stale' // descriptor present but process dead or endpoint unreachable
  | 'none'; // no descriptor
