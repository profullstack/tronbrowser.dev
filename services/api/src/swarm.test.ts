import { describe, expect, it } from 'vitest';
import { resolveSwarmProvider, slowJson, takeHouseRun, C0MPUTE_BASE } from './swarm.js';

describe('resolveSwarmProvider', () => {
  const env = { C0MPUTE_API_KEY: 'ik_live_house' };

  it("a user's own key keeps priority, whatever the provider", () => {
    expect(resolveSwarmProvider({ provider: 'openai', apiKey: 'sk-mine' }, env)).toEqual({
      provider: 'openai',
      apiKey: 'sk-mine',
      house: false,
    });
    expect(resolveSwarmProvider({ apiKey: 'sk-ant' }, env)).toEqual({ provider: 'anthropic', apiKey: 'sk-ant', house: false });
    expect(resolveSwarmProvider({ provider: 'c0mpute', apiKey: 'ik_live_mine' }, env)).toEqual({
      provider: 'c0mpute',
      apiKey: 'ik_live_mine',
      house: false,
    });
  });

  it('no key + provider c0mpute runs on the house key', () => {
    expect(resolveSwarmProvider({ provider: 'c0mpute' }, env)).toEqual({
      provider: 'c0mpute',
      apiKey: 'ik_live_house',
      house: true,
    });
  });

  it('no key and no provider is refused unless the operator made c0mpute the default', () => {
    expect(resolveSwarmProvider({}, env)).toHaveProperty('error');
    expect(resolveSwarmProvider({}, { ...env, SWARM_DEFAULT_PROVIDER: 'c0mpute' })).toMatchObject({
      provider: 'c0mpute',
      house: true,
    });
  });

  it('no key with another provider, or no house key configured, is refused', () => {
    expect(resolveSwarmProvider({ provider: 'openai' }, env)).toHaveProperty('error');
    expect(resolveSwarmProvider({ provider: 'c0mpute' }, {})).toHaveProperty('error');
  });

  it('points at the Infernet OpenAI-compatible endpoint', () => {
    expect(C0MPUTE_BASE).toBe('https://infernetprotocol.com/v1');
  });
});

describe('takeHouseRun', () => {
  it('caps house-key runs per user per day', () => {
    const env = { SWARM_C0MPUTE_DAILY: '2' };
    const day = new Date('2026-11-07T12:00:00Z');
    expect(takeHouseRun('u1', env, day)).toBe(true);
    expect(takeHouseRun('u1', env, day)).toBe(true);
    expect(takeHouseRun('u1', env, day)).toBe(false);
    expect(takeHouseRun('u2', env, day)).toBe(true);
    expect(takeHouseRun('u1', env, new Date('2026-11-08T00:00:01Z'))).toBe(true);
  });
});

describe('slowJson', () => {
  it('keeps the connection alive with spaces, then sends parseable JSON', async () => {
    const res = slowJson(() => new Promise((r) => setTimeout(() => r({ ok: 1 }), 60)), 10);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.startsWith(' ')).toBe(true);
    expect(JSON.parse(text)).toEqual({ ok: 1 });
  });

  it('turns a failure into an error body', async () => {
    const res = slowJson(async () => {
      throw new Error('no node');
    });
    expect(JSON.parse(await res.text())).toEqual({ error: 'no node' });
  });
});
