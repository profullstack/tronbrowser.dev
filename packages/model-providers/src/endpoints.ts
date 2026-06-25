/**
 * Default API base URLs per provider. Local providers point at their default
 * loopback ports. All except Anthropic speak the OpenAI-compatible chat API
 * (Gemini via its OpenAI-compatibility endpoint).
 */

import type { ProviderId } from './index.js';

export const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseek: 'https://api.deepseek.com/v1',
  perplexity: 'https://api.perplexity.ai',
  huggingface: 'https://router.huggingface.co/v1',
  kimi: 'https://api.moonshot.ai/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
  vllm: 'http://localhost:8000/v1',
};

/** Anthropic uses its own Messages API; everything else is OpenAI-compatible. */
export function usesAnthropicApi(id: ProviderId): boolean {
  return id === 'anthropic';
}
