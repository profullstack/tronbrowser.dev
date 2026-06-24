/**
 * @tronbrowser/sync
 * Cross-device sync of user-owned objects (PRD §Sync).
 */

export const PACKAGE_NAME = '@tronbrowser/sync' as const;

/** Object kinds that sync across devices. */
export const SYNC_OBJECTS = [
  'bookmarks',
  'prompts',
  'workflows',
  'settings',
  'profiles',
] as const;
export type SyncObjectKind = (typeof SYNC_OBJECTS)[number];

export interface SyncRecord<T = unknown> {
  id: string;
  kind: SyncObjectKind;
  /** Monotonic version for last-write-wins / conflict detection. */
  version: number;
  updatedAt: string;
  deleted?: boolean;
  data: T;
}

export interface SyncDelta {
  since: number;
  records: SyncRecord[];
}

/** Client-side sync engine. Data is user-owned and self-hostable. */
export interface SyncEngine {
  pull(kind: SyncObjectKind, since: number): Promise<SyncDelta>;
  push(records: SyncRecord[]): Promise<{ accepted: string[]; conflicts: SyncRecord[] }>;
}
