/**
 * @tronbrowser/ai-core
 * AI orchestration core: routes requests across providers and execution modes.
 *
 * NOTE: at M0 the provider/execution types are mirrored locally to keep stubs
 * decoupled before anything is built. They will be re-exported from
 * `@tronbrowser/model-providers` once that package emits declarations (M2).
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

export interface RoutingPolicy {
  /** Preferred execution location; hybrid falls back local→cloud. */
  mode: ExecutionMode;
  /** Ordered provider preference. */
  providers: ProviderId[];
}

export interface AICompletionRequest {
  model: string;
  prompt: string;
  system?: string;
}

export interface AICompletionResponse {
  text: string;
  model: string;
  provider: ProviderId;
}

/** Orchestrates a completion across the configured providers. */
export interface AICore {
  readonly policy: RoutingPolicy;
  complete(req: AICompletionRequest): Promise<AICompletionResponse>;
}
