/**
 * Provider catalog. The BYOK env var names match the providers used across
 * Profullstack apps (crawlproof.com): a user brings their own keys for the
 * free/self-hosted experience; the paid cloud uses our keys from the DB.
 */

import type { ProviderId } from './index.js';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /**
   * Env var the BYOK key is read from. Matches crawlproof.com naming.
   * `undefined` for local/keyless providers.
   */
  envVar?: string;
  /** Alternate env var names accepted for the same key. */
  envVarAliases?: string[];
  /** Local providers run on-device and need no API key. */
  local: boolean;
  /** Exposes an OpenAI-compatible HTTP API. */
  openaiCompatible: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic:   { id: 'anthropic',   label: 'Anthropic (Claude)',  envVar: 'ANTHROPIC_API_KEY',   local: false, openaiCompatible: false },
  openai:      { id: 'openai',      label: 'OpenAI',              envVar: 'OPENAI_API_KEY',      local: false, openaiCompatible: true  },
  google:      { id: 'google',      label: 'Google (Gemini)',     envVar: 'GEMINI_API_KEY',      local: false, openaiCompatible: false },
  deepseek:    { id: 'deepseek',    label: 'DeepSeek',            envVar: 'DEEPSEEK_API_KEY',    local: false, openaiCompatible: true  },
  perplexity:  { id: 'perplexity',  label: 'Perplexity (Sonar)',  envVar: 'PERPLEXITY_API_KEY',  local: false, openaiCompatible: true  },
  huggingface: { id: 'huggingface', label: 'Hugging Face',        envVar: 'HUGGINGFACE_API_KEY', local: false, openaiCompatible: false },
  kimi:        { id: 'kimi',        label: 'Kimi (Moonshot AI)',  envVar: 'MOONSHOT_API_KEY',    envVarAliases: ['KIMI_API_KEY'], local: false, openaiCompatible: true },
  qwen:        { id: 'qwen',        label: 'Qwen (Alibaba)',      envVar: 'DASHSCOPE_API_KEY',   envVarAliases: ['QWEN_API_KEY'], local: false, openaiCompatible: true },
  ollama:      { id: 'ollama',      label: 'Ollama (local)',      local: true,  openaiCompatible: true  },
  lmstudio:    { id: 'lmstudio',    label: 'LM Studio (local)',   local: true,  openaiCompatible: true  },
  vllm:        { id: 'vllm',        label: 'vLLM (self-hosted)',  local: true,  openaiCompatible: true  },
};

/** BYOK cloud providers that require an API key (the crawlproof.com set). */
export const BYOK_PROVIDERS: ProviderId[] = Object.values(PROVIDERS)
  .filter((p) => !p.local)
  .map((p) => p.id);

/** Keyless local providers. */
export const LOCAL_PROVIDERS: ProviderId[] = Object.values(PROVIDERS)
  .filter((p) => p.local)
  .map((p) => p.id);

export function getProvider(id: ProviderId): ProviderInfo {
  return PROVIDERS[id];
}
