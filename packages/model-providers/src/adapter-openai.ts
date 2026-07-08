/**
 * OpenAI-compatible provider adapter. Works for OpenAI, DeepSeek, Perplexity,
 * Kimi (Moonshot), Qwen (DashScope), Google (Gemini OpenAI-compat endpoint),
 * and local runtimes (Ollama, LM Studio, vLLM).
 */

import type { ProviderId } from './index.js';
import type {
  ModelProvider,
  CompletionRequest,
  CompletionResponse,
  CompletionChunk,
} from './index.js';

export interface OpenAIAdapterConfig {
  baseUrl: string;
  apiKey: string;
  /** Defaults to global fetch; injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * OpenAI's "pro" reasoning models (gpt-5-pro, gpt-5.5-pro, o1-pro, o3-pro) and
 * the codex models are served only by the Responses API (/v1/responses). Posting
 * them to /chat/completions 404s with "This is not a chat model...". Route those
 * to /responses. Only OpenAI itself exposes that endpoint — the other
 * OpenAI-compatible providers (DeepSeek, Perplexity, …) stay on /chat/completions.
 */
export function usesResponsesApi(providerId: ProviderId, model: string): boolean {
  return providerId === 'openai' && /-pro(\b|-)|codex/i.test(model);
}

/** Concatenates the text of every `output_text` part in a Responses `output`. */
function extractResponsesText(
  output?: { type?: string; content?: { type?: string; text?: string }[] }[],
): string {
  let text = '';
  for (const item of output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === 'output_text' && part.text) text += part.text;
    }
  }
  return text;
}

export class OpenAICompatibleProvider implements ModelProvider {
  constructor(
    readonly id: ProviderId,
    readonly local: boolean,
    private readonly config: OpenAIAdapterConfig,
  ) {}

  private get fetch(): typeof fetch {
    return this.config.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.apiKey) h['authorization'] = `Bearer ${this.config.apiKey}`;
    return h;
  }

  async listModels(): Promise<string[]> {
    const res = await this.fetch(`${this.config.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) throw new Error(`${this.id} listModels failed: ${res.status}`);
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => m.id);
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    if (usesResponsesApi(this.id, req.model)) return this.completeViaResponses(req);
    const res = await this.fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`${this.id} completion failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const text = body.choices?.[0]?.message?.content ?? '';
    const out: CompletionResponse = { text, model: req.model };
    if (body.usage) {
      out.usage = {
        promptTokens: body.usage.prompt_tokens,
        completionTokens: body.usage.completion_tokens,
      };
    }
    return out;
  }

  async *stream(req: CompletionRequest): AsyncIterable<CompletionChunk> {
    if (usesResponsesApi(this.id, req.model)) {
      yield* this.streamViaResponses(req);
      return;
    }
    const res = await this.fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`${this.id} stream failed: ${res.status}`);
    }
    for await (const data of sseLines(res.body)) {
      if (data === '[DONE]') {
        yield { delta: '', done: true };
        return;
      }
      try {
        const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield { delta, done: false };
      } catch {
        // ignore keep-alive / non-JSON lines
      }
    }
    yield { delta: '', done: true };
  }

  /**
   * Responses API (/v1/responses) path for OpenAI's pro/codex models. The
   * role/content messages map straight onto `input`; pro models reject
   * `temperature`, so it is omitted.
   */
  private async completeViaResponses(req: CompletionRequest): Promise<CompletionResponse> {
    const res = await this.fetch(`${this.config.baseUrl}/responses`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: req.model,
        input: req.messages,
        max_output_tokens: req.maxTokens,
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`${this.id} completion failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      output_text?: string;
      output?: { type?: string; content?: { type?: string; text?: string }[] }[];
      usage?: { input_tokens: number; output_tokens: number };
    };
    const text = body.output_text ?? extractResponsesText(body.output);
    const out: CompletionResponse = { text, model: req.model };
    if (body.usage) {
      out.usage = {
        promptTokens: body.usage.input_tokens,
        completionTokens: body.usage.output_tokens,
      };
    }
    return out;
  }

  private async *streamViaResponses(req: CompletionRequest): AsyncIterable<CompletionChunk> {
    const res = await this.fetch(`${this.config.baseUrl}/responses`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: req.model,
        input: req.messages,
        max_output_tokens: req.maxTokens,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`${this.id} stream failed: ${res.status}`);
    }
    for await (const data of sseLines(res.body)) {
      if (data === '[DONE]') {
        yield { delta: '', done: true };
        return;
      }
      try {
        const evt = JSON.parse(data) as { type?: string; delta?: string };
        if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
          yield { delta: evt.delta, done: false };
        } else if (evt.type === 'response.completed' || evt.type === 'response.failed') {
          yield { delta: '', done: true };
          return;
        }
      } catch {
        // ignore keep-alive / non-JSON lines
      }
    }
    yield { delta: '', done: true };
  }
}

/** Yields the payload of each `data:` line from an SSE response stream. */
export async function* sseLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}
