import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('extension network helper requests', () => {
  let listeners;
  let fetchMock;

  beforeEach(async () => {
    vi.resetModules();
    listeners = [];
    const done = () => vi.fn().mockResolvedValue(undefined);
    const storage = () => ({ get: vi.fn().mockResolvedValue({}), set: done(), remove: done() });
    vi.stubGlobal('chrome', {
      sidePanel: { setPanelBehavior: done() },
      action: {
        onClicked: { addListener: vi.fn() }, setBadgeText: done(),
        setBadgeBackgroundColor: done(), setTitle: done(),
      },
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: (listener) => listeners.push(listener) },
        sendMessage: done(),
      },
      storage: { local: storage(), session: storage() },
      proxy: { settings: { set: done(), clear: done() } },
      privacy: { network: { webRTCIPHandlingPolicy: { set: done(), clear: done() } } },
    });
    fetchMock = vi.fn(async (url) => ({
      json: async () => url.endsWith('/pit/start')
        ? { started: true, port: 9081, check: { ok: true } }
        : { started: true, ready: true, IsTor: true },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await import('./background.js');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function send(message) {
    return new Promise((resolve, reject) => {
      if (!listeners.some((listener) => listener(message, {}, resolve) === true)) {
        reject(new Error('No listener handled ' + message.type));
      }
    });
  }

  function helperCalls() {
    return fetchMock.mock.calls.filter(([url]) => url.startsWith('http://127.0.0.1:9061/'));
  }

  function expectSimpleRequests() {
    for (const [, options] of helperCalls()) {
      expect(options.headers).toBeUndefined();
      expect(options.body).toBeUndefined();
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  }

  it('starts and stops Pit using simple POST requests to literal loopback', async () => {
    expect(await send({ type: 'pit-set', on: true })).toMatchObject({ enabled: true, port: 9081 });
    expect(await send({ type: 'pit-set', on: false })).toEqual({ enabled: false });
    expect(helperCalls().map(([url, options]) => [new URL(url).pathname, options.method]))
      .toEqual([['/pit/start', 'POST'], ['/pit/stop', 'POST']]);
    expectSimpleRequests();
  });

  it('uses POST for Tor mutations and GET only for status', async () => {
    expect(await send({ type: 'tor-set', on: true })).toMatchObject({ enabled: true });
    expect(await send({ type: 'tor-set', on: false })).toEqual({ enabled: false });
    expect(helperCalls().map(([url, options]) => [new URL(url).pathname, options.method]))
      .toEqual([['/start', 'POST'], ['/status', 'GET'], ['/stop', 'POST']]);
    expectSimpleRequests();
  });
});
