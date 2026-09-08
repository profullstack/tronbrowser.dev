/**
 * Render the real BrowserScreen/App and drive public WebView callbacks.
 * Android RNCWebViewClient.doUpdateVisitedHistory emits a loading-start event
 * even when loading=false; WebViewShared forwards it to onLoadStart. Such a
 * history update need not have a later load-end event. Native dispatch itself
 * is not executed by these component tests.
 */
import { describe, expect, it } from 'vitest';
import App from '../App';
import { BrowserScreen } from '../src/screens/BrowserScreen';
import { fire, hosts, hostWhere, renderScreen, switchTab } from './harness';
import { Platform } from './mocks/react-native';
import { theWebView, webViewRegistry } from './mocks/react-native-webview';

import type { ReactTestInstance } from 'react-test-renderer';

const webView = (root: ReactTestInstance) =>
  hostWhere(root, 'WebView', () => true, 'browser WebView');

const navigationEvent = (loading: boolean, url = 'https://example.test/page') => ({
  nativeEvent: { url, loading, title: '', canGoBack: true, canGoForward: false, target: 1 },
});

describe('BrowserScreen loading state', () => {
  it.each(['android', 'ios'] as const)('shows a real pending load and clears it on %s', async (platform) => {
    Platform.OS = platform;
    const { root } = await renderScreen(<BrowserScreen />);
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
    await fire(webView(root), 'onLoadStart', navigationEvent(true));
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(1);
    await fire(webView(root), 'onLoadEnd', navigationEvent(false));
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
  });

  it('does not start an endless spinner for an already-completed history update', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(webView(root), 'onLoadStart', navigationEvent(true));
    await fire(webView(root), 'onLoadEnd', navigationEvent(false));
    // A same-document history update can arrive without a network load/finish.
    await fire(webView(root), 'onLoadStart', navigationEvent(false, 'https://example.test/page#section'));
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
  });

  it('preserves iOS start indication before navigation policy allows the load', async () => {
    Platform.OS = 'ios';
    const { root } = await renderScreen(<BrowserScreen />);
    // iOS samples the current loading flag before allowing the new navigation.
    await fire(webView(root), 'onLoadStart', navigationEvent(false));
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(1);
    await fire(webView(root), 'onLoadEnd', navigationEvent(false));
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
  });

  it.each([
    { code: -2, description: 'net::ERR_NAME_NOT_RESOLVED', url: 'https://offline.example.test/' },
    { code: -1, description: 'net::ERR_CLEARTEXT_NOT_PERMITTED', url: 'http://example.test/' },
    { code: -11, description: 'SSL error: The certificate authority is not trusted', url: 'https://tls.example.test/' },
  ])('keeps a finished $description load stopped after a history callback', async ({ code, description, url }) => {
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(webView(root), 'onLoadStart', navigationEvent(true, url));
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(1);
    const completed = navigationEvent(false, url);
    // The WebView library calls onLoadEnd for errors too, before any later
    // history callback. These are synthetic payloads, not real network errors.
    await fire(webView(root), 'onLoadEnd', {
      nativeEvent: { ...completed.nativeEvent, code, description },
    });
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
    await fire(webView(root), 'onLoadStart', completed);
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
  });

  it('keeps hidden completion stopped on tab return and still shows a user-triggered retry', async () => {
    const { root } = await renderScreen(<App />);
    const id = theWebView().id;
    await fire(webView(root), 'onLoadStart', navigationEvent(true));
    await switchTab(root, 'Chat');
    await fire(webView(root), 'onLoadEnd', navigationEvent(false));
    await fire(webView(root), 'onLoadStart', navigationEvent(false));
    await switchTab(root, 'Browse');
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
    expect(theWebView().id).toBe(id);
    expect(webViewRegistry()).toHaveLength(1);

    const reload = hostWhere(root, 'TouchableOpacity', (n) => n.props.accessibilityLabel === 'Reload', 'reload button');
    await fire(reload, 'onPress');
    expect(theWebView().calls.reload).toBe(1);
    await fire(webView(root), 'onLoadStart', navigationEvent(true));
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(1);
    await fire(webView(root), 'onLoadEnd', navigationEvent(false));
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
    expect(webViewRegistry()).toHaveLength(1);
  });
});
