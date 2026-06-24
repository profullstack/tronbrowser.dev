/**
 * @tronbrowser/storage
 * Storage abstraction over SQLite/libSQL (Turso cloud or the user's own DB),
 * plus object storage (Cloudflare R2). Config + contracts at this stage.
 */

export const PACKAGE_NAME = '@tronbrowser/storage' as const;

export * from './config.js';

/** Minimal SQL database contract; backed by libSQL/SQLite. */
export interface Database {
  execute(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowsAffected: number }>;
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<void>;
  close(): Promise<void>;
}

/** Object storage contract (Cloudflare R2 / S3-compatible). */
export interface ObjectStore {
  put(key: string, body: Uint8Array | string): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
}
