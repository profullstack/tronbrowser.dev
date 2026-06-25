import { describe, it, expect, vi } from 'vitest';
import { createAICore, type Backend, type RoutingPolicy } from './index.js';

const echo = (text: string): Backend => ({
  complete: async (req) => ({ text, model: req.model }),
  async *stream() {
    yield { delta: text, done: false };
    yield { delta: '', done: true };
  },
});

describe('createAICore', () => {
  const policy: RoutingPolicy = { mode: 'hybrid', providers: ['ollama', 'anthropic', 'openai'] };

  it('routes to the first available provider in order', async () => {
    const resolve = vi.fn(async (p) => (p === 'anthropic' ? echo('hi') : undefined));
    const core = createAICore(policy, resolve);
    const res = await core.complete({ model: 'claude-opus-4-8', messages: [] });

    expect(res).toEqual({ text: 'hi', model: 'claude-opus-4-8', provider: 'anthropic' });
    // ollama tried first (undefined), then anthropic resolved
    expect(resolve.mock.calls.map((c) => c[0])).toEqual(['ollama', 'anthropic']);
  });

  it('streams from the chosen backend', async () => {
    const core = createAICore(policy, async (p) => (p === 'ollama' ? echo('stream!') : undefined));
    const out: string[] = [];
    for await (const c of core.stream({ model: 'llama3', messages: [] })) {
      if (c.delta) out.push(c.delta);
    }
    expect(out.join('')).toBe('stream!');
  });

  it('throws when no provider is available', async () => {
    const core = createAICore(policy, async () => undefined);
    await expect(core.complete({ model: 'x', messages: [] })).rejects.toThrow(/no available provider/);
  });
});
