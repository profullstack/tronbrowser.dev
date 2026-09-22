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
export type ChatFailure =
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
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, CHAT_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener('abort', forwardAbort, {once:true});
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new ChatError(timedOut ? 'timeout' : 'cancelled'));
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
      body: JSON.stringify({
        messages: history.map(({ role, text }) => ({ role, text })),
      }),
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new ChatError('http');
    }
    let data: unknown;
    try {
      data = await response.json();
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
      throw new ChatError(timedOut ? 'timeout' : 'cancelled');
    throw error instanceof ChatError ? error : new ChatError('network');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}
