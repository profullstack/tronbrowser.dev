/**
 * Bonus scope: `window.open` / `target="_blank"` navigations show up in the
 * current single tab instead of vanishing into a detached Android WebView —
 * but only validated HTTP(S) targets may reach `source`, and Android's
 * multi-window isolation stays enabled.
 */
import { describe, expect, it } from 'vitest';
import { HOME } from '../src/lib/navigation';
import { BrowserScreen } from '../src/screens/BrowserScreen';
import { actAsync, hostWhere, renderScreen } from './harness';
import { theWebView, webViewRegistry } from './mocks/react-native-webview';

describe('window.open / target=_blank', () => {
  it('navigates even when the popup repeats the last source URL after an in-page navigation', async () => {
    await renderScreen(<BrowserScreen />);
    await actAsync(() => theWebView().emitOpenWindow('https://example.com/first'));
    await actAsync(() => theWebView().emitNavigationState({
      url: 'https://example.com/second', canGoBack: true, canGoForward: false,
    }));
    await actAsync(() => theWebView().emitOpenWindow('https://example.com/first'));
    expect(theWebView().calls.injected).toEqual([
      'window.location.assign("https://example.com/first");true;',
    ]);
    expect(webViewRegistry()).toHaveLength(1);
  });
  it('opens an HTTPS popup target in this tab, keeping the same WebView', async () => {
    const renderer = await renderScreen(<BrowserScreen />);
    await actAsync(() => theWebView().emitOpenWindow('https://example.com/popup'));

    expect(theWebView().props.source).toEqual({ uri: 'https://example.com/popup' });
    const addressBar = hostWhere(
      renderer.root,
      'TextInput',
      (n) => n.props.placeholder === 'Search or enter address',
      'address bar',
    );
    expect(addressBar.props.value).toBe('https://example.com/popup');
    // Navigation happened by prop update on the one live WebView — a remount
    // here would throw away the page history the user can go Back through.
    expect(webViewRegistry()).toHaveLength(1);
  });

  it('drops javascript:, data:, and other non-web targets', async () => {
    await renderScreen(<BrowserScreen />);
    const hostileTargets = [
      'javascript:alert(document.cookie)',
      'data:text/html,<script>alert(1)</script>',
      'intent://scan/#Intent;scheme=zxing;end',
      'about:blank',
      'file:///etc/passwd',
      'not a url at all',
    ];
    for (const target of hostileTargets) {
      await actAsync(() => theWebView().emitOpenWindow(target));
      expect(theWebView().props.source).toEqual({ uri: HOME });
      expect(theWebView().calls.injected).toEqual([]);
    }
  });

  it('keeps Android multi-window isolation on while handling opens', async () => {
    await renderScreen(<BrowserScreen />);
    // The fix must come from onOpenWindow, not from disabling
    // setSupportMultipleWindows (which would drop window isolation).
    expect(typeof theWebView().props.onOpenWindow).toBe('function');
    expect(theWebView().props.setSupportMultipleWindows).toBeUndefined();
  });
});
