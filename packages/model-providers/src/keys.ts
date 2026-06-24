/**
 * API key resolution for AI providers.
 *
 * Two sources:
 *  - **byok**  — the user brings their own keys (free / self-hosted). Read from
 *    the web app environment (.env) or the user's own store.
 *  - **cloud** — the paid tier uses OUR keys, stored in the database and scoped
 *    per app (`appId`) because Profullstack runs multiple apps off one vault.
 *
 * A `ProviderKeyVault` is app-scoped; compose several with `resolveProviderKey`
 * (e.g. prefer the user's BYOK key, fall back to the cloud key on paid plans).
 */

import type { ProviderId } from './index.js';
import { getProvider } from './catalog.js';

export type KeySource = 'byok' | 'cloud';

export interface ProviderKey {
  provider: ProviderId;
  apiKey: string;
  source: KeySource;
}

/** Resolves an API key for `provider`, scoped to `appId`. */
export interface ProviderKeyVault {
  readonly source: KeySource;
  getKey(appId: string, provider: ProviderId): Promise<string | undefined>;
}

/** BYOK: reads the user's own keys from environment variables (web app .env). */
export class EnvKeyVault implements ProviderKeyVault {
  readonly source: KeySource = 'byok';
  constructor(private readonly env: Record<string, string | undefined>) {}

  async getKey(_appId: string, provider: ProviderId): Promise<string | undefined> {
    const info = getProvider(provider);
    if (!info.envVar) return undefined; // local/keyless
    for (const name of [info.envVar, ...(info.envVarAliases ?? [])]) {
      const value = this.env[name];
      if (value && value.length > 0) return value;
    }
    return undefined;
  }
}

/** Backing store for cloud keys; implemented over the DB (see storage migration). */
export interface CloudKeyStore {
  /** Look up our managed key for (appId, provider). */
  lookup(appId: string, provider: ProviderId): Promise<string | undefined>;
}

/** Cloud (paid): our managed keys, stored per app in the database. */
export class DbCloudKeyVault implements ProviderKeyVault {
  readonly source: KeySource = 'cloud';
  constructor(private readonly store: CloudKeyStore) {}

  getKey(appId: string, provider: ProviderId): Promise<string | undefined> {
    return this.store.lookup(appId, provider);
  }
}

/**
 * Resolves a key for `provider` by trying vaults in order, returning the first
 * hit (and which source it came from). Returns undefined if none has a key.
 */
export async function resolveProviderKey(
  appId: string,
  provider: ProviderId,
  vaults: ProviderKeyVault[],
): Promise<ProviderKey | undefined> {
  for (const vault of vaults) {
    const apiKey = await vault.getKey(appId, provider);
    if (apiKey) return { provider, apiKey, source: vault.source };
  }
  return undefined;
}
