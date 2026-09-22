# Chat recovery validation

The companion chat makes one request per explicit Send or Retry. A 30-second
deadline covers both response headers and JSON body. Stop, Clear and actual
unmount abort the request and invalidate late completions. Switching tabs does
not unmount chat. Aborting locally does not prove that a remote service stopped
processing the prompt; a manual retry can incur another server-side request.

Only completed user/assistant pairs enter future history. Failed prompts remain
retryable without inserting error messages or duplicate prompts. Sending a new
prompt replaces the failed turn. Clear requires confirmation and preserves the
composer draft. History remains in memory, not persistent storage.

`test/ai.test.ts` covers transport and deadlines; `test/chat-recovery.test.tsx`
uses the real screen and app tab lifecycle with a deferred transport stub.
Neither proves native device behavior or the real AI backend contract. Without
`EXPO_PUBLIC_AI_ENDPOINT`, the existing explicitly labeled offline echo remains.

`test/ai-http.test.ts` also runs real Node fetch against a loopback HTTP server:
headers/body deadlines, cancellation and socket closure, explicit retry, UTF-8,
connection reset and sanitized failures. These tests deliberately wait for the
real 30-second deadline. They do not contact a real AI service or exercise the
React Native networking implementation.

Before release, exercise keyboard/layout, Stop/Retry/Clear and slow/offline
requests on the native target. JS export verifies bundling, not native runtime.
