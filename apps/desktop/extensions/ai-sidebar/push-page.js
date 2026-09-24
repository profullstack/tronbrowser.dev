// Runs in every page's own world (MAIN), before its scripts. Replaces
// PushManager's methods so subscribe() goes to TronBrowser's configured push
// service instead of the engine's, which does not exist in ungoogled-chromium.
// Talks to push-bridge.js (isolated world) by window messages; the background
// does the rest (push-client.js). With the setting 'off', every call falls
// through to the engine's own implementation.
(() => {
  if (typeof PushManager === 'undefined' || typeof ServiceWorkerRegistration === 'undefined') return;
  if (window.top !== window) return; // top-level documents only, like the bridge
  const native = {
    subscribe: PushManager.prototype.subscribe,
    getSubscription: PushManager.prototype.getSubscription,
    permissionState: PushManager.prototype.permissionState,
  };
  const scopes = new WeakMap(); // PushManager -> its registration's scope
  const pmGetter = Object.getOwnPropertyDescriptor(ServiceWorkerRegistration.prototype, 'pushManager')?.get;
  if (pmGetter) {
    Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', {
      configurable: true,
      enumerable: true,
      get() {
        const pm = pmGetter.call(this);
        if (pm && !scopes.has(pm)) scopes.set(pm, this.scope);
        return pm;
      },
    });
  }

  let seq = 0;
  const waiting = new Map();
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.__tronPush !== 'response') return;
    const done = waiting.get(event.data.id);
    if (done) { waiting.delete(event.data.id); done(event.data.result || {}); }
  });
  const ask = (type, payload) =>
    new Promise((resolve) => {
      const id = `${Date.now()}-${++seq}`;
      waiting.set(id, resolve);
      window.postMessage({ __tronPush: 'request', id, type, ...payload }, location.origin);
    });

  const toB64u = (input) => {
    if (typeof input === 'string') return input.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const u8 = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const fromB64u = (text) => {
    const normal = text.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(normal + '==='.slice((normal.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  };
  const fail = (result) => { throw new DOMException(result.message || 'Registration failed', result.error || 'AbortError'); };

  // A real PushSubscription as far as the page can tell: instanceof holds and
  // the fields, getKey, toJSON and unsubscribe behave as specified.
  function subscriptionFrom(data, scope) {
    const sub = Object.create(PushSubscription.prototype);
    const appKey = data.applicationServerKey ? fromB64u(data.applicationServerKey) : null;
    const define = (name, value) => Object.defineProperty(sub, name, { value, enumerable: true });
    define('endpoint', data.endpoint);
    define('expirationTime', null);
    define('options', Object.freeze({ userVisibleOnly: true, applicationServerKey: appKey }));
    define('getKey', (name) => (data.keys[name] ? fromB64u(data.keys[name]) : null));
    define('toJSON', () => ({ endpoint: data.endpoint, expirationTime: null, keys: { ...data.keys } }));
    define('unsubscribe', async () => (await ask('push:unsubscribe', { scope })).ok === true);
    return sub;
  }

  PushManager.prototype.subscribe = async function (options = {}) {
    const scope = scopes.get(this);
    if (options.userVisibleOnly === false) {
      throw new DOMException('Push subscriptions must be userVisibleOnly.', 'NotAllowedError');
    }
    const probe = await ask('push:get', { scope });
    if (probe.off) return native.subscribe.call(this, options);
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') {
      throw new DOMException('Registration failed - permission denied', 'NotAllowedError');
    }
    const appKey = options.applicationServerKey == null ? null : toB64u(options.applicationServerKey);
    const result = await ask('push:subscribe', { scope, applicationServerKey: appKey });
    if (result.off) return native.subscribe.call(this, options);
    if (result.error) fail(result);
    return subscriptionFrom(result.subscription, scope);
  };

  PushManager.prototype.getSubscription = async function () {
    const scope = scopes.get(this);
    const result = await ask('push:get', { scope });
    if (result.off) return native.getSubscription.call(this);
    if (result.error) fail(result);
    return result.subscription ? subscriptionFrom(result.subscription, scope) : null;
  };

  PushManager.prototype.permissionState = async function (options) {
    const result = await ask('push:get', { scope: scopes.get(this) });
    if (result.off) return native.permissionState.call(this, options);
    return Notification.permission === 'default' ? 'prompt' : Notification.permission;
  };
})();
