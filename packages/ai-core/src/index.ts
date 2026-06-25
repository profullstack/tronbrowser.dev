/**
 * @tronbrowser/ai-core
 * AI orchestration core: routes a request across providers per a RoutingPolicy.
 *
 * Kept decoupled from @tronbrowser/model-providers via dependency injection — a
 * `BackendResolver` yields a callable backend for a provider id. The desktop /
 * sidebar layer wires model-providers' `createProvider` + key vaults into it.
 */

export const PACKAGE_NAME = '@tronbrowser/ai-core' as const;

/** Mirrors @tronbrowser/model-providers ExecutionMode (PRD §AI Execution). */
export type ExecutionMode = 'local' | 'cloud' | 'hybrid';

/** Mirrors @tronbrowser/model-providers ProviderId (PRD §AI Providers). */
export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'deepseek'
  | 'perplexity'
  | 'huggingface'
  | 'kimi'
  | 'qwen'
  | 'ollama'
  | 'lmstudio'
  | 'vllm';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  text: string;
  model: string;
  provider: ProviderId;
}

export interface ChatChunk {
  delta: string;
  done: boolean;
}

/** Minimal backend contract; @tronbrowser/model-providers' ModelProvider satisfies it. */
export interface Backend {
  complete(req: ChatRequest): Promise<{ text: string; model: string }>;
  stream(req: ChatRequest): AsyncIterable<ChatChunk>;
}

/**
 * Resolves a callable backend for a provider, or undefined if unavailable
 * (no key, local runtime down, etc.).
 */
export type BackendResolver = (provider: ProviderId) => Promise<Backend | undefined>;

export interface RoutingPolicy {
  /** Preferred execution location; informational for hybrid routing. */
  mode: ExecutionMode;
  /** Ordered provider preference. */
  providers: ProviderId[];
}

/** Orchestrates a completion across the configured providers. */
export interface AICore {
  readonly policy: RoutingPolicy;
  complete(req: ChatRequest): Promise<ChatResponse>;
  stream(req: ChatRequest): AsyncIterable<ChatChunk>;
}

class RoutedAICore implements AICore {
  constructor(
    readonly policy: RoutingPolicy,
    private readonly resolve: BackendResolver,
  ) {}

  private async pick(): Promise<{ provider: ProviderId; backend: Backend }> {
    for (const provider of this.policy.providers) {
      const backend = await this.resolve(provider);
      if (backend) return { provider, backend };
    }
    throw new Error(
      `ai-core: no available provider among [${this.policy.providers.join(', ')}]`,
    );
  }

  async complete(req: ChatRequest): Promise<ChatResponse> {
    const { provider, backend } = await this.pick();
    const res = await backend.complete(req);
    return { text: res.text, model: res.model, provider };
  }

  async *stream(req: ChatRequest): AsyncIterable<ChatChunk> {
    const { backend } = await this.pick();
    yield* backend.stream(req);
  }
}

/** Builds an AICore that routes per `policy` using `resolver`. */
export function createAICore(policy: RoutingPolicy, resolver: BackendResolver): AICore {
  return new RoutedAICore(policy, resolver);
}
