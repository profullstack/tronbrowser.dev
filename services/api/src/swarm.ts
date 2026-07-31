/**
 * /api/swarm — run a deepagents-backed agent swarm, powered by
 * @logicsrc/agentswarm. Signed-in, bring-your-own-key: the caller supplies a
 * provider + API key per request (used transiently, NOT stored — same model as
 * /api/models). An optional `rubric` turns on the self-check loop.
 */
import { Hono } from 'hono';
import {
  createDeepAgentRunner,
  createRubricRunner,
  createLLMJudge,
  type SwarmRunner,
} from '@logicsrc/agentswarm';

/** OpenAI-compatible provider bases (mirrors /api/models). anthropic is special-cased. */
const OPENAI_COMPAT_BASE: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseek: 'https://api.deepseek.com/v1',
  perplexity: 'https://api.perplexity.ai',
  huggingface: 'https://router.huggingface.co/v1',
  kimi: 'https://api.moonshot.ai/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  c0mpute: 'https://api.c0mpute.com/v1',
};

/** Build a LangChain chat model for the requested provider with the caller's key. */
async function buildModel(
  provider: string,
  apiKey: string,
  model?: string,
  baseUrl?: string,
): Promise<object> {
  if (provider === 'anthropic') {
    const { ChatAnthropic } = await import('@langchain/anthropic');
    return new ChatAnthropic({ apiKey, model: model || 'claude-sonnet-4-6' });
  }
  const base = (baseUrl || OPENAI_COMPAT_BASE[provider] || '').replace(/\/$/, '');
  if (!base || /localhost|127\.0\.0\.1/.test(base)) {
    throw new Error(`unsupported or disallowed provider/baseUrl: ${provider}`);
  }
  const { ChatOpenAI } = await import('@langchain/openai');
  return new ChatOpenAI({ apiKey, model: model || 'gpt-4o-mini', configuration: { baseURL: base } });
}

export interface SwarmDeps {
  /** Resolves the signed-in user, or null. */
  currentUser: (c: any) => Promise<{ id: string } | null>;
}

/** Hono sub-router mounted at /api/swarm. */
export function swarmRoutes(deps: SwarmDeps): Hono {
  const r = new Hono();

  r.post('/', async (c) => {
    const user = await deps.currentUser(c);
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const body = await c.req.json().catch(() => ({} as any));
    const { messages, rubric, provider = 'anthropic', apiKey, model, baseUrl } = body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return c.json({ error: 'messages must be a non-empty array' }, 400);
    }
    if (!apiKey || typeof apiKey !== 'string') {
      return c.json({ error: 'apiKey required (bring your own key)' }, 400);
    }

    try {
      const llm = await buildModel(String(provider), apiKey, model, baseUrl);
      let runner: SwarmRunner = await createDeepAgentRunner({ model: llm });
      if (typeof rubric === 'string' && rubric.trim()) {
        runner = createRubricRunner({ runner, judge: await createLLMJudge({ chatModel: llm }) });
      }
      const result = await runner.run({ messages, rubric });
      return c.json(result);
    } catch (e: any) {
      return c.json({ error: e?.message || String(e) }, 500);
    }
  });

  return r;
}
