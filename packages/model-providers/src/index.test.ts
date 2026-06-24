import { describe, it, expect } from 'vitest';
import { isLocalProvider, PROVIDER_IDS } from './index.js';

describe('@tronbrowser/model-providers', () => {
  it('classifies local providers', () => {
    expect(isLocalProvider('ollama')).toBe(true);
    expect(isLocalProvider('lmstudio')).toBe(true);
    expect(isLocalProvider('vllm')).toBe(true);
    expect(isLocalProvider('openai')).toBe(false);
    expect(isLocalProvider('anthropic')).toBe(false);
  });

  it('lists the seven PRD providers', () => {
    expect(PROVIDER_IDS).toHaveLength(7);
    expect(PROVIDER_IDS).toContain('anthropic');
  });
});
