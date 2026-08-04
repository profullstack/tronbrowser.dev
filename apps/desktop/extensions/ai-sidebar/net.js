// Bounded I/O for anything the UI does on open.
//
// The new tab and the side panel both render by awaiting a chain of network and
// storage calls. `fetch()` has no default timeout: a host that accepts the
// connection and then never answers leaves the promise pending forever, and the
// section waiting on it stays on its placeholder for the life of the tab — the
// page looks frozen rather than degraded. background.js, moshpit.js and the
// per-feed fetch already each carried their own AbortController for this
// reason; this is that same pattern, in one place, for the rest of them.
//
// chrome.storage.local is bounded for the same reason: it is backed by a
// LevelDB in the profile, and a large or damaged one can leave a get() pending.
// A settings read that never resolves must not decide whether the UI appears.

/** Network calls on a render path. Long enough for a slow host, short enough to notice. */
export const DEFAULT_TIMEOUT_MS = 8000;

/** Local storage reads. Should be instant; anything near this is already broken. */
export const STORAGE_TIMEOUT_MS = 3000;

/**
 * fetch() that always settles. Rejects with 'timed out' rather than hanging.
 * Pass `ms` to override the default budget.
 */
export async function fetchWithTimeout(url, opts = {}, ms = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    // A caller-supplied signal aborting is the caller's business; ours is a timeout.
    throw e?.name === 'AbortError' ? new Error('timed out') : e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve to `fallback` if `promise` hasn't settled within `ms`. Used where a
 * missing answer is survivable and a missing render is not — the caller gets
 * defaults and the page draws.
 */
export function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * chrome.storage.local.get that always settles. Returns `{}` if storage stalls,
 * which every caller here already handles as "no value stored".
 */
export function storageGet(keys) {
  return withTimeout(chrome.storage.local.get(keys), STORAGE_TIMEOUT_MS, {});
}
