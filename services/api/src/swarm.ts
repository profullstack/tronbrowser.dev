/**
 * /api/swarm — run a deepagents-backed agent swarm, powered by
 * @logicsrc/agentswarm. Signed-in, bring-your-own-key: the caller supplies a
 * provider + API key per request (used transiently, NOT stored — same model as
 * /api/models). An optional `rubric` turns on the self-check loop.
 *
 * c0mpute (the Infernet peer network, OpenAI-compatible at
 * infernetprotocol.com/v1) is a provider too. A caller with a c0mpute key of
 * their own uses it; a caller with no key at all may pick `provider: "c0mpute"`
 * and run on the house key (C0MPUTE_API_KEY), capped per user per day. A
 * caller's own key always wins.
 *
 * c0mpute is ON BY DEFAULT: a request that names no provider and no key runs on
 * c0mpute too (Anthony, 2026-11-11: "c0mpute turned on by default, no keys
 * necessary for low usage"). Jobs are end-to-end encrypted to the winning
 * worker (DIP-0032). An operator can turn the default off with
 * SWARM_DEFAULT_PROVIDER=none.
 *
 * c0mpute is slow under load (minutes per call), longer than the edge proxy's
 * read timeout. A house-key run therefore answers 200 at once and writes a
 * space every 15 s until the JSON result (or `{"error": ...}`) follows; leading
 * whitespace is valid JSON, so `await res.json()` works unchanged.
 */
import { Hono } from 'hono';
import {
  createDeepAgentRunner,
  createRubricRunner,
  createLLMJudge,
  type SwarmRunner,
} from '@logicsrc/agentswarm';

/** Infernet's OpenAI-compatible endpoint (api.c0mpute.com does not resolve). */
export const C0MPUTE_BASE = 'https://infernetprotocol.com/v1';
/** The house model every Infernet node pulls. */
export const C0MPUTE_MODEL = 'huihui_ai/qwen3.5-abliterated:9b';
/** House-key swarm runs one user may start per UTC day (SWARM_C0MPUTE_DAILY). */
export const DEFAULT_C0MPUTE_DAILY = 30;

/** OpenAI-compatible provider bases (mirrors /api/models). anthropic is special-cased. */
const OPENAI_COMPAT_BASE: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseek: 'https://api.deepseek.com/v1',
  perplexity: 'https://api.perplexity.ai',
  huggingface: 'https://router.huggingface.co/v1',
  kimi: 'https://api.moonshot.ai/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  c0mpute: C0MPUTE_BASE,
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
  if (provider === 'c0mpute') {
    return new ChatOpenAI({
      apiKey,
      model: model || C0MPUTE_MODEL,
      configuration: { baseURL: base },
      // Peer nodes: often 60-240 s a call under load.
      timeout: 15 * 60_000,
      maxRetries: 1,
    });
  }
  return new ChatOpenAI({ apiKey, model: model || 'gpt-4o-mini', configuration: { baseURL: base } });
}

/**
 * Which provider and key a swarm request runs on.
 *
 *   own key                     -> the caller's provider and key (c0mpute included)
 *   no key, provider c0mpute    -> c0mpute on the house key
 *   no key, no provider         -> c0mpute on the house key (the default),
 *                                  unless SWARM_DEFAULT_PROVIDER=none
 *   no key, any other provider  -> refused, as before
 */
export function resolveSwarmProvider(
  body: { provider?: unknown; apiKey?: unknown },
  env: Record<string, string | undefined> = process.env,
): { provider: string; apiKey: string; house: boolean } | { error: string } {
  const own = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const named = typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim() : '';
  if (own) return { provider: named || 'anthropic', apiKey: own, house: false };

  const defaultOff = (env.SWARM_DEFAULT_PROVIDER || '').trim().toLowerCase() === 'none';
  const wantsC0mpute = named === 'c0mpute' || (!named && !defaultOff);
  if (!wantsC0mpute) {
    return { error: 'apiKey required (bring your own key), or set provider "c0mpute" to run on c0mpute without one' };
  }
  const house = (env.C0MPUTE_API_KEY || '').trim();
  if (!house) return { error: 'c0mpute is not configured on this server; bring your own key' };
  return { provider: 'c0mpute', apiKey: house, house: true };
}

/** In-memory per-user daily count of house-key runs. */
const houseRuns = new Map<string, { day: string; n: number }>();
export function takeHouseRun(userId: string, env: Record<string, string | undefined> = process.env, now = new Date()): boolean {
  const cap = Number(env.SWARM_C0MPUTE_DAILY);
  const limit = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : DEFAULT_C0MPUTE_DAILY;
  const day = now.toISOString().slice(0, 10);
  const cur = houseRuns.get(userId);
  const n = cur && cur.day === day ? cur.n : 0;
  if (n >= limit) return false;
  houseRuns.set(userId, { day, n: n + 1 });
  return true;
}

/**
 * A JSON response for slow work: 200 now, a space every `everyMs` so no proxy
 * or idle timer closes the connection, then the JSON body.
 */
export function slowJson(work: () => Promise<unknown>, everyMs = 15_000): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const tick = setInterval(() => {
        try {
          controller.enqueue(enc.encode(' '));
        } catch {
          clearInterval(tick);
        }
      }, everyMs);
      let body: unknown;
      try {
        body = await work();
      } catch (e: any) {
        body = { error: e?.message || String(e) };
      } finally {
        clearInterval(tick);
      }
      try {
        controller.enqueue(enc.encode(JSON.stringify(body)));
        controller.close();
      } catch {
        /* client went away */
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      // Ask nginx not to buffer, so the keepalive spaces reach the client.
      'x-accel-buffering': 'no',
    },
  });
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
    const { messages, rubric, model, baseUrl } = body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return c.json({ error: 'messages must be a non-empty array' }, 400);
    }
    const chosen = resolveSwarmProvider(body);
    if ('error' in chosen) return c.json({ error: chosen.error }, 400);
    if (chosen.house && !takeHouseRun(user.id)) {
      return c.json({ error: 'daily c0mpute limit reached; bring your own key or try tomorrow' }, 429);
    }

    const run = async () => {
      // The house key only ever goes to the house endpoint.
      const llm = await buildModel(chosen.provider, chosen.apiKey, model, chosen.house ? undefined : baseUrl);
      let runner: SwarmRunner = await createDeepAgentRunner({ model: llm });
      if (typeof rubric === 'string' && rubric.trim()) {
        runner = createRubricRunner({ runner, judge: await createLLMJudge({ chatModel: llm }) });
      }
      const result = await runner.run({ messages, rubric });
      return chosen.provider === 'c0mpute' && result && typeof result === 'object'
        ? { ...(result as object), provider: 'c0mpute' }
        : result;
    };

    if (chosen.provider === 'c0mpute') return slowJson(run);

    try {
      return c.json((await run()) as any);
    } catch (e: any) {
      return c.json({ error: e?.message || String(e) }, 500);
    }
  });

  return r;
}
