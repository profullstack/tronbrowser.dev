/**
 * Anthropic (Claude) provider adapter — uses the Messages API, which differs
 * from the OpenAI chat shape: the system prompt is a top-level field.
 */

import type {
  ModelProvider,
  CompletionRequest,
  CompletionResponse,
  CompletionChunk,
  ChatMessage,
} from './index.js';
import { sseLines } from './adapter-openai.js';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 1024;

export interface AnthropicAdapterConfig {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

/** Splits a flat message list into Anthropic's (system, messages) shape. */
function splitSystem(messages: ChatMessage[]): {
  system: string | undefined;
  rest: { role: 'user' | 'assistant'; content: string }[];
} {
  const system = messages.find((m) => m.role === 'system')?.content;
  const rest = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  return { system, rest };
}

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic' as const;
  readonly local = false;

  constructor(private readonly config: AnthropicAdapterConfig) {}

  private get fetch(): typeof fetch {
    return this.config.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }

  async listModels(): Promise<string[]> {
    const res = await this.fetch(`${this.config.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) throw new Error(`anthropic listModels failed: ${res.status}`);
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => m.id);
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const { system, rest } = splitSystem(req.messages);
    const res = await this.fetch(`${this.config.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: req.temperature,
        ...(system ? { system } : {}),
        messages: rest,
      }),
    });
    if (!res.ok) throw new Error(`anthropic completion failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens: number; output_tokens: number };
    };
    const text = (body.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    const out: CompletionResponse = { text, model: req.model };
    if (body.usage) {
      out.usage = {
        promptTokens: body.usage.input_tokens,
        completionTokens: body.usage.output_tokens,
      };
    }
    return out;
  }

  async *stream(req: CompletionRequest): AsyncIterable<CompletionChunk> {
    const { system, rest } = splitSystem(req.messages);
    const res = await this.fetch(`${this.config.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: req.temperature,
        ...(system ? { system } : {}),
        messages: rest,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) throw new Error(`anthropic stream failed: ${res.status}`);
    for await (const data of sseLines(res.body)) {
      try {
        const evt = JSON.parse(data) as {
          type: string;
          delta?: { type?: string; text?: string };
        };
        if (evt.type === 'content_block_delta' && evt.delta?.text) {
          yield { delta: evt.delta.text, done: false };
        } else if (evt.type === 'message_stop') {
          yield { delta: '', done: true };
          return;
        }
      } catch {
        // ignore non-JSON events
      }
    }
    yield { delta: '', done: true };
  }
}
