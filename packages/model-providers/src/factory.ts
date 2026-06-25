/**
 * Provider factory: build a ready-to-call ModelProvider for any provider id,
 * given an API key. Picks the Anthropic adapter for Claude and the
 * OpenAI-compatible adapter for everything else.
 */

import type { ProviderId, ModelProvider } from './index.js';
import { getProvider } from './catalog.js';
import { DEFAULT_BASE_URLS, usesAnthropicApi } from './endpoints.js';
import { OpenAICompatibleProvider } from './adapter-openai.js';
import { AnthropicProvider } from './adapter-anthropic.js';

export interface CreateProviderOptions {
  apiKey: string;
  /** Override the default base URL (e.g. a self-hosted/proxy endpoint). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createProvider(id: ProviderId, opts: CreateProviderOptions): ModelProvider {
  const info = getProvider(id);
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URLS[id];
  const fetchImpl = opts.fetchImpl;

  if (usesAnthropicApi(id)) {
    return new AnthropicProvider({
      baseUrl,
      apiKey: opts.apiKey,
      ...(fetchImpl ? { fetchImpl } : {}),
    });
  }

  return new OpenAICompatibleProvider(id, info.local, {
    baseUrl,
    apiKey: opts.apiKey,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
