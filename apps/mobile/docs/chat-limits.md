# Chat request and response limits

The mobile chat adapter accepts at most 65536 UTF-8 bytes of serialized request
JSON and at most 65536 bytes of response JSON. Limits include field names,
history, escaping and multibyte characters, not just the latest prompt.
Exactly the limit is accepted; larger messages fail with an explicit size error.
History is never silently truncated. Failed text remains visible; clear history
requires confirmation. Oversized requests do not offer an identical retry.

Responses with an excessive declared Content-Length are rejected before reading.
Stream-capable transports also count actual bytes and cancel oversized bodies,
including those without or with misleading length headers. Buffered React Native
fetch is checked after text decoding, before JSON parsing. It may already have
downloaded the body into native memory: this is not a native download memory cap.
The first cancel, timeout or detected oversize event remains the reported cause.

Tests cover Unicode size boundaries, offline request rejection, body cancellation,
late fetch responses, terminal-event ordering, retained UI state, and real
loopback HTTP (including stalled headers/body and unterminated oversized data).
Local Android/iOS bundle export checks compilation, not device runtime or a real
provider. Device transport behavior remains a release verification item.
