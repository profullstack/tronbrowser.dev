import { describe, it, expect } from 'vitest';
import {
  isLocalProvider,
  PROVIDER_IDS,
  BYOK_PROVIDERS,
  LOCAL_PROVIDERS,
  getProvider,
  EnvKeyVault,
  DbCloudKeyVault,
  resolveProviderKey,
  type CloudKeyStore,
} from './index.js';

describe('@tronbrowser/model-providers catalog', () => {
  it('classifies local providers', () => {
    expect(isLocalProvider('ollama')).toBe(true);
    expect(isLocalProvider('vllm')).toBe(true);
    expect(isLocalProvider('anthropic')).toBe(false);
    expect(isLocalProvider('kimi')).toBe(false);
  });

  it('has the 8 BYOK providers from crawlproof.com', () => {
    expect([...BYOK_PROVIDERS].sort()).toEqual(
      ['anthropic', 'deepseek', 'google', 'huggingface', 'kimi', 'openai', 'perplexity', 'qwen'].sort(),
    );
    expect(LOCAL_PROVIDERS).toEqual(['ollama', 'lmstudio', 'vllm']);
    expect(PROVIDER_IDS).toHaveLength(11);
  });

  it('maps providers to the crawlproof.com env var names', () => {
    expect(getProvider('google').envVar).toBe('GEMINI_API_KEY');
    expect(getProvider('qwen').envVar).toBe('DASHSCOPE_API_KEY');
    expect(getProvider('kimi').envVar).toBe('MOONSHOT_API_KEY');
    expect(getProvider('ollama').envVar).toBeUndefined();
  });
});

describe('provider key vaults', () => {
  it('EnvKeyVault reads BYOK keys from env (incl. aliases)', async () => {
    const vault = new EnvKeyVault({
      ANTHROPIC_API_KEY: 'sk-ant',
      KIMI_API_KEY: 'sk-kimi', // alias of MOONSHOT_API_KEY
    });
    expect(await vault.getKey('tronbrowser', 'anthropic')).toBe('sk-ant');
    expect(await vault.getKey('tronbrowser', 'kimi')).toBe('sk-kimi');
    expect(await vault.getKey('tronbrowser', 'openai')).toBeUndefined();
    expect(await vault.getKey('tronbrowser', 'ollama')).toBeUndefined();
    expect(vault.source).toBe('byok');
  });

  it('DbCloudKeyVault looks up our keys per app', async () => {
    const store: CloudKeyStore = {
      lookup: async (appId, provider) =>
        appId === 'tronbrowser' && provider === 'openai' ? 'cloud-openai' : undefined,
    };
    const vault = new DbCloudKeyVault(store);
    expect(await vault.getKey('tronbrowser', 'openai')).toBe('cloud-openai');
    expect(await vault.getKey('crawlproof', 'openai')).toBeUndefined();
    expect(vault.source).toBe('cloud');
  });

  it('resolveProviderKey prefers BYOK, falls back to cloud', async () => {
    const byok = new EnvKeyVault({ OPENAI_API_KEY: 'user-key' });
    const cloud = new DbCloudKeyVault({ lookup: async () => 'our-key' });

    const a = await resolveProviderKey('tronbrowser', 'openai', [byok, cloud]);
    expect(a).toEqual({ provider: 'openai', apiKey: 'user-key', source: 'byok' });

    const b = await resolveProviderKey('tronbrowser', 'anthropic', [byok, cloud]);
    expect(b).toEqual({ provider: 'anthropic', apiKey: 'our-key', source: 'cloud' });

    const none = await resolveProviderKey('tronbrowser', 'deepseek', [byok]);
    expect(none).toBeUndefined();
  });
});
