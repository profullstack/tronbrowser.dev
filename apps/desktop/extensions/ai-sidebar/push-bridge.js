// Isolated-world half of the pushManager replacement: forwards push-page.js's
// requests to the background and hands the answers back. The background reads
// the origin from Chrome's sender info, so nothing the page sends here can act
// for another site.
(() => {
  if (window.top !== window) return;
  const TYPES = new Set(['push:subscribe', 'push:get', 'push:unsubscribe']);
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || data?.__tronPush !== 'request' || !TYPES.has(data.type)) return;
    const reply = (result) =>
      window.postMessage({ __tronPush: 'response', id: data.id, result }, location.origin);
    try {
      chrome.runtime.sendMessage(
        { type: data.type, scope: typeof data.scope === 'string' ? data.scope : undefined, applicationServerKey: data.applicationServerKey ?? null },
        (result) => {
          if (chrome.runtime.lastError) reply({ error: 'AbortError', message: 'Registration failed - push service error' });
          else reply(result);
        },
      );
    } catch {
      // The extension was reloaded under this page; behave as if push is off.
      reply({ off: true });
    }
  });
})();
