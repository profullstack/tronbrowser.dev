import { describe, expect, it } from 'vitest';
import { effectiveConfig, runsWithoutKey, DEFAULT_CONFIG, PROVIDERS } from './providers.js';

describe('c0mpute is on by default', () => {
  it('runs on c0mpute with nothing saved', () => {
    expect(effectiveConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(effectiveConfig(undefined).provider).toBe('c0mpute');
    expect(DEFAULT_CONFIG.apiKey).toBe('');
  });

  it('c0mpute needs no key; key-required providers still do', () => {
    expect(runsWithoutKey('c0mpute')).toBe(true);
    expect(runsWithoutKey('ollama')).toBe(true);
    expect(runsWithoutKey('anthropic')).toBe(false);
    expect(runsWithoutKey('nope')).toBe(false);
  });

  it("a user's own configured provider wins", () => {
    const mine = { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant', baseUrl: '' };
    expect(effectiveConfig(mine)).toBe(mine);
    const local = { provider: 'ollama', model: 'llama3.2', apiKey: '', baseUrl: '' };
    expect(effectiveConfig(local)).toBe(local);
    const ownC0 = { provider: 'c0mpute', model: 'qwen2.5:7b', apiKey: '', baseUrl: '' };
    expect(effectiveConfig(ownC0)).toBe(ownC0);
  });

  it('a saved key-required provider with no key falls back to c0mpute', () => {
    expect(effectiveConfig({ provider: 'openai', model: 'gpt-5', apiKey: '' }).provider).toBe('c0mpute');
    expect(effectiveConfig({ provider: 'openai', apiKey: 'sk' }).provider).toBe('c0mpute'); // no model
  });

  it('points at Infernet', () => {
    expect(PROVIDERS.c0mpute.baseUrl).toBe('https://infernetprotocol.com/v1');
  });
});
