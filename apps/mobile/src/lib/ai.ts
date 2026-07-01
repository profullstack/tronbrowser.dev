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

/** Endpoint override (e.g. from Expo config). Empty = offline echo mode. */
export const AI_ENDPOINT = process.env.EXPO_PUBLIC_AI_ENDPOINT ?? '';

export async function sendChat(history: ChatMessage[]): Promise<ChatMessage> {
  const last = history[history.length - 1]?.text ?? '';

  if (!AI_ENDPOINT) {
    // Offline placeholder until the provider is wired.
    await new Promise((r) => setTimeout(r, 350));
    return {
      id: `a-${Date.now()}`,
      role: 'assistant',
      text: `You said: “${last}”. (Offline stub — set EXPO_PUBLIC_AI_ENDPOINT to reach a model.)`,
    };
  }

  const res = await fetch(`${AI_ENDPOINT}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: history.map(({ role, text }) => ({ role, text })) }),
  });
  if (!res.ok) throw new Error(`AI request failed (${res.status})`);
  const data = (await res.json()) as { text?: string };
  return { id: `a-${Date.now()}`, role: 'assistant', text: data.text ?? '(empty response)' };
}
