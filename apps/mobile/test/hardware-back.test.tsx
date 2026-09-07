/**
 * Android hardware-Back policy through the real App + BrowserScreen: intercept
 * only while the Browser tab is active AND the WebView has history to pop;
 * otherwise the event must fall through to the system (leave the app). The
 * subscription itself must disappear whenever the condition stops holding.
 */
import { describe, expect, it } from 'vitest';
import App from '../App';
import { actAsync, renderScreen, switchTab } from './harness';
import {
  backPressSubscriptionCount,
  emitHardwareBackPress,
  Platform,
} from './mocks/react-native';
import { theWebView } from './mocks/react-native-webview';

async function pressSystemBack(): Promise<boolean> {
  let handled = false;
  await actAsync(() => {
    handled = emitHardwareBackPress();
  });
  return handled;
}

function browseTo(url: string, canGoBack: boolean) {
  return actAsync(() =>
    theWebView().emitNavigationState({ url, canGoBack, canGoForward: false }),
  );
}

describe('hardware Back', () => {
  it('leaves Back to the system while there is no history', async () => {
    await renderScreen(<App />);
    expect(backPressSubscriptionCount()).toBe(0);
    expect(await pressSystemBack()).toBe(false);
    expect(theWebView().calls.goBack).toBe(0);
  });

  it('pops WebView history while Browser is active with history', async () => {
    await renderScreen(<App />);
    await browseTo('https://example.com/two', true);
    expect(await pressSystemBack()).toBe(true);
    expect(theWebView().calls.goBack).toBe(1);
  });

  it('stops intercepting once history is exhausted', async () => {
    await renderScreen(<App />);
    await browseTo('https://example.com/two', true);
    expect(await pressSystemBack()).toBe(true);
    await browseTo('https://example.com/', false);
    expect(backPressSubscriptionCount()).toBe(0);
    expect(await pressSystemBack()).toBe(false);
    expect(theWebView().calls.goBack).toBe(1);
  });

  it('never intercepts from a hidden Browser tab, and re-arms on return', async () => {
    const renderer = await renderScreen(<App />);
    await browseTo('https://example.com/two', true);

    await switchTab(renderer.root, 'Chat');
    // The subscription is removed — not merely ignored — so other back logic
    // (and the system default) is never shadowed by a background tab.
    expect(backPressSubscriptionCount()).toBe(0);
    expect(await pressSystemBack()).toBe(false);
    expect(theWebView().calls.goBack).toBe(0);

    await switchTab(renderer.root, 'Browse');
    expect(backPressSubscriptionCount()).toBe(1);
    expect(await pressSystemBack()).toBe(true);
    expect(theWebView().calls.goBack).toBe(1);
  });

  it('cleans up its subscription on unmount', async () => {
    const renderer = await renderScreen(<App />);
    await browseTo('https://example.com/two', true);
    expect(backPressSubscriptionCount()).toBe(1);
    await actAsync(() => renderer.unmount());
    expect(backPressSubscriptionCount()).toBe(0);
  });

  it('does not subscribe at all on iOS', async () => {
    Platform.OS = 'ios';
    await renderScreen(<App />);
    await browseTo('https://example.com/two', true);
    expect(backPressSubscriptionCount()).toBe(0);
  });
});
