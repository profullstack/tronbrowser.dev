/**
 * Storage configuration. TronBrowser is self-hostable (PRD §Principles): the
 * default is the managed cloud database (Turso, with managed backups), but a
 * user can point at their **own** SQLite database — a local file or their own
 * libSQL/Turso URL — and own their data fully.
 */

/** Where the SQLite/libSQL database lives. */
export type StorageDriver = 'turso' | 'libsql-local' | 'sqlite-file';

/**
 * Service tier. `cloud` is the managed Turso deployment (automatic backups,
 * replication, PITR). `self-hosted` is the user's own DB — they own backups.
 */
export type StorageTier = 'cloud' | 'self-hosted';

interface BaseStorageConfig {
  driver: StorageDriver;
  tier: StorageTier;
}

/** Managed cloud DB or any remote libSQL/Turso URL. */
export interface TursoConfig extends BaseStorageConfig {
  driver: 'turso';
  url: string;
  authToken: string;
}

/** User's own local libSQL database file (embedded replica capable). */
export interface LibsqlLocalConfig extends BaseStorageConfig {
  driver: 'libsql-local';
  tier: 'self-hosted';
  path: string;
  /** Optional sync URL to replicate a remote libSQL into the local file. */
  syncUrl?: string;
  authToken?: string;
}

/** Plain on-disk SQLite file the user controls. */
export interface SqliteFileConfig extends BaseStorageConfig {
  driver: 'sqlite-file';
  tier: 'self-hosted';
  path: string;
}

export type StorageConfig = TursoConfig | LibsqlLocalConfig | SqliteFileConfig;

/** Env var names TronBrowser reads to configure storage. */
export const ENV = {
  url: 'TRONBROWSER_DB_URL',
  authToken: 'TRONBROWSER_DB_AUTH_TOKEN',
  path: 'TRONBROWSER_DB_PATH',
} as const;

/**
 * Resolves storage config from environment-like input.
 *
 * Precedence (lets a user bring their own DB):
 *   1. `TRONBROWSER_DB_PATH`  -> local SQLite file (self-hosted)
 *   2. `TRONBROWSER_DB_URL`   -> libSQL/Turso URL
 *        - `file:`/`./`/`/`   -> local libSQL file (self-hosted)
 *        - otherwise          -> remote Turso (cloud if *.turso.io, else self-hosted)
 *
 * @throws if a remote URL is given without an auth token.
 */
export function resolveStorageConfig(env: Record<string, string | undefined>): StorageConfig {
  const path = env[ENV.path];
  if (path) {
    return { driver: 'sqlite-file', tier: 'self-hosted', path };
  }

  const url = env[ENV.url];
  if (!url) {
    throw new Error(
      `No storage configured. Set ${ENV.url} (libSQL/Turso URL) or ${ENV.path} (local SQLite file).`,
    );
  }

  const isLocalFile = url.startsWith('file:') || url.startsWith('./') || url.startsWith('/');
  if (isLocalFile) {
    return { driver: 'libsql-local', tier: 'self-hosted', path: url.replace(/^file:/, '') };
  }

  const authToken = env[ENV.authToken];
  if (!authToken) {
    throw new Error(`Remote DB URL requires ${ENV.authToken}.`);
  }
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`${ENV.url} must be a valid remote libSQL/Turso URL or a local file path.`);
  }

  // Managed Turso (*.turso.io) gets the cloud tier (managed backups); any other
  // remote libSQL the user runs themselves is self-hosted.
  const tier: StorageTier = /\.turso\.io$/.test(hostname) ? 'cloud' : 'self-hosted';
  return { driver: 'turso', tier, url, authToken };
}

/** Whether this configuration has managed backups. Only the cloud tier does. */
export function supportsManagedBackups(config: StorageConfig): boolean {
  return config.tier === 'cloud';
}
