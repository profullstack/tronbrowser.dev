/**
 * AI seam for the mobile companion.
 *
 * This is the single integration point for the real model provider. Today it
 * returns a local echo so the UI is exercisable offline and in CI; swap the body
 * of `sendChat` for a call into `@tronbrowser/ai-core` / the cloud API
 * (services/api) once the mobile auth + endpoint are wired.
 */
export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
}

export const CHAT_TIMEOUT_MS = 30000;
export const MAX_CHAT_REQUEST_BYTES = 65536;
export const MAX_CHAT_RESPONSE_BYTES = 65536;
export type ChatFailure =
  | 'request_too_large'
  | 'response_too_large'
  | 'timeout'
  | 'cancelled'
  | 'network'
  | 'http'
  | 'invalid';
export class ChatError extends Error {
  constructor(readonly kind: ChatFailure) {
    super(kind);
    this.name = 'ChatError';
  }
}

function offlineDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new ChatError('cancelled'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 350);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** One attempt. Cancellation cannot guarantee that the remote service stopped. */
export async function sendChat(history: readonly ChatMessage[], options: {signal?: AbortSignal} = {}): Promise<string> {
  if (options.signal?.aborted) throw new ChatError('cancelled');
  const body = JSON.stringify({ messages: history.map(({ role, text }) => ({ role, text })) });
  if (new TextEncoder().encode(body).byteLength > MAX_CHAT_REQUEST_BYTES)
    throw new ChatError('request_too_large');
  const controller = new AbortController();
  // The first terminating event wins; cancelling transport must not hide a size error.
  let failure: ChatFailure = 'cancelled';
  const stop = (kind: ChatFailure) => {
    if (controller.signal.aborted) return;
    failure = kind;
    controller.abort();
  };
  const timer = setTimeout(() => stop('timeout'), CHAT_TIMEOUT_MS);
  const forwardAbort = () => stop('cancelled');
  options.signal?.addEventListener('abort', forwardAbort, {once:true});
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new ChatError(failure));
    controller.signal.addEventListener('abort', rejectAbort, {once:true});
  });
  const work = async () => {
    const endpoint = process.env.EXPO_PUBLIC_AI_ENDPOINT ?? '';
    if (!endpoint) {
      await offlineDelay(controller.signal);
      const last = history[history.length - 1]?.text ?? '';
      return `You said: “${last}”. (Offline stub — set EXPO_PUBLIC_AI_ENDPOINT to reach a model.)`;
    }
    const response = await fetch(`${endpoint.replace(/\/+$/, '')}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body,
    });
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      throw new ChatError(failure);
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new ChatError('http');
    }
    const tooLarge = (): never => {
      stop('response_too_large');
      throw new ChatError(failure);
    };
    if (Number(response.headers.get('content-length')) > MAX_CHAT_RESPONSE_BYTES) {
      void response.body?.cancel().catch(() => {});
      tooLarge();
    }
    let text: string;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const cancel = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', cancel, { once: true });
      try {
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        while (true) {
          const chunk = await reader.read();
          if (controller.signal.aborted) throw new ChatError(failure);
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > MAX_CHAT_RESPONSE_BYTES) tooLarge();
          chunks.push(chunk.value);
        }
        const data = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
        text = new TextDecoder().decode(data);
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        reader.releaseLock();
      }
    } else {
      // RN's buffered fetch may already have downloaded the whole body natively.
      // This limits JSON processing/retention, not peak native download memory.
      text = await response.text();
      if (controller.signal.aborted) throw new ChatError(failure);
      if (new TextEncoder().encode(text).byteLength > MAX_CHAT_RESPONSE_BYTES) tooLarge();
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ChatError('invalid');
    }
    if (
      !data ||
      typeof data !== 'object' ||
      !('text' in data) ||
      typeof data.text !== 'string' ||
      !data.text.trim()
    )
      throw new ChatError('invalid');
    return data.text;
  };
  try {
    return await Promise.race([work(), aborted]);
  } catch (error) {
    if (controller.signal.aborted)
      throw new ChatError(failure);
    throw error instanceof ChatError ? error : new ChatError('network');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}
