/**
 * @tronbrowser/model-providers
 * Pluggable LLM provider adapters. Interfaces only — implementations land in M2+.
 */

export const PACKAGE_NAME = '@tronbrowser/model-providers' as const;

/** Providers supported by TronBrowser (PRD §AI Providers). */
export const PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'ollama',
  'lmstudio',
  'vllm',
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Where inference runs (PRD §AI Execution). */
export type ExecutionMode = 'local' | 'cloud' | 'hybrid';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface CompletionChunk {
  delta: string;
  done: boolean;
}

export interface CompletionResponse {
  text: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/** Adapter contract every provider must implement. */
export interface ModelProvider {
  readonly id: ProviderId;
  /** Local providers (ollama, lmstudio, vllm) never require a cloud key. */
  readonly local: boolean;
  listModels(): Promise<string[]>;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  stream(req: CompletionRequest): AsyncIterable<CompletionChunk>;
}

/** Registry of provider adapters, keyed by id. */
export interface ProviderRegistry {
  register(provider: ModelProvider): void;
  get(id: ProviderId): ModelProvider | undefined;
  list(): ModelProvider[];
}

export function isLocalProvider(id: ProviderId): boolean {
  return id === 'ollama' || id === 'lmstudio' || id === 'vllm';
}
