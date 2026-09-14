import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserScreen } from '../src/screens/BrowserScreen';
import { actAsync, fire, hosts, hostWhere, renderScreen, textContents } from './harness';
import { Platform, StyleSheet, emitHardwareBackPress } from './mocks/react-native';
import { theWebView, webViewRegistry } from './mocks/react-native-webview';
import type { ReactTestInstance } from 'react-test-renderer';

const FIRST = 'https://example.test/first';
const SECOND = 'https://example.test/second';
const input = (root: ReactTestInstance) => hostWhere(root, 'TextInput', () => true, 'address');
const web = (root: ReactTestInstance) => hostWhere(root, 'WebView', () => true, 'webview');
const button = (root: ReactTestInstance, label: string) => hostWhere(root, 'TouchableOpacity',
  n => n.props.accessibilityLabel === label, label);
const event = (url: string, loading = true) => ({
  nativeEvent: { url, loading, canGoBack: true, canGoForward: false, title: '', target: 1 },
});
const errorEvent = (url: string, code = -2, description = 'net::ERR_NAME_NOT_RESOLVED') => ({
  ...event(url, false),
  nativeEvent: { ...event(url, false).nativeEvent, code, description },
  preventDefault: vi.fn(),
});
const navigate = (url: string) => actAsync(() => theWebView().emitNavigationState({
  url, canGoBack: true, canGoForward: false,
}));
async function submit(root: ReactTestInstance, url: string) {
  await fire(input(root), 'onChangeText', url);
  await fire(input(root), 'onSubmitEditing');
}

describe.each(['android', 'ios'] as const)('browser recovery on %s', platform => {
  beforeEach(() => { Platform.OS = platform; });
  afterEach(() => { vi.useRealTimers(); });
  it('does not let a redirect replace an unfinished address edit', async () => {
    Platform.OS = platform;
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(input(root), 'onFocus');
    await fire(input(root), 'onChangeText', 'my unfinished search');
    await navigate(SECOND);
    expect(input(root).props.value).toBe('my unfinished search');
    await fire(input(root), 'onSubmitEditing');
    expect(theWebView().props.source?.uri).toBe('https://duckduckgo.com/?q=my%20unfinished%20search');
  });

  it('restores the current page address when an edit is dismissed without submitting', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(input(root), 'onFocus');
    await fire(input(root), 'onChangeText', 'not submitted');
    await navigate(SECOND);
    await fire(input(root), 'onBlur');
    expect(input(root).props.value).toBe(SECOND);
  });

  it('resubmits the source URL after an in-page navigation without remounting', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await submit(root, FIRST);
    await navigate(SECOND);
    await submit(root, FIRST);
    expect(theWebView().calls.injected).toEqual([
      `window.location.assign(${JSON.stringify(FIRST)});true;`,
    ]);
    expect(webViewRegistry()).toHaveLength(1);
  });

  it('reloads rather than navigating again when submitting the page already displayed', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await submit(root, FIRST);
    await fire(web(root), 'onLoadEnd', event(FIRST, false));
    await navigate(FIRST);
    await submit(root, FIRST);
    expect(theWebView().calls.reload).toBe(1);
    expect(webViewRegistry()).toHaveLength(1);
  });

  it('does not reload the wrong in-flight page when submitting the previous committed URL', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await submit(root, FIRST);
    await fire(web(root), 'onLoadStart', event(FIRST));
    await fire(web(root), 'onLoadEnd', event(FIRST, false));
    await submit(root, SECOND);
    await fire(web(root), 'onLoadStart', event(SECOND));
    await submit(root, FIRST);
    expect(theWebView().calls.reload).toBe(0);
    expect(theWebView().props.source?.uri).toBe(FIRST);
  });

  it('offers manual retry after a network error without exposing raw native details', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(web(root), 'onLoadStart', event(FIRST));
    const failure = errorEvent(FIRST, -2, 'private native failure data');
    await fire(web(root), 'onError', failure);
    await fire(web(root), 'onLoadEnd', event(FIRST, false));
    expect(failure.preventDefault).toHaveBeenCalledOnce();
    expect(textContents(root)).toContain('This page did not finish loading.');
    expect(textContents(root)).not.toContain('private native failure data');
    expect(theWebView().calls.reload).toBe(0);
    const failedView = theWebView();
    await fire(button(root, 'Retry page'), 'onPress');
    expect(failedView.mounted).toBe(false);
    expect(theWebView().props.source?.uri).toBe(FIRST);
    await fire(web(root), 'onLoadStart', event(FIRST));
    await fire(web(root), 'onLoadEnd', event(FIRST, false));
    expect(textContents(root)).not.toContain('This page did not finish loading.');
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
  });

  it('ignores an old page failure/finish after another page starts loading', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(web(root), 'onLoadStart', event(FIRST));
    await fire(web(root), 'onLoadStart', event(SECOND));
    await fire(web(root), 'onError', errorEvent(FIRST));
    await fire(web(root), 'onLoadEnd', event(FIRST, false));
    expect(textContents(root)).not.toContain('This page did not finish loading.');
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(1);
  });

  it('uses the pending address for manual retry if the native failure omits its URL', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await submit(root, FIRST);
    await fire(web(root), 'onError', errorEvent(''));
    expect(textContents(root)).toContain('This page did not finish loading.');
    const hidden = hostWhere(root, 'View', n => n.props.pointerEvents === 'none', 'failed page');
    expect(hidden.props.accessibilityElementsHidden).toBe(true);
    expect(hidden.props.importantForAccessibility).toBe('no-hide-descendants');
    await fire(button(root, 'Retry page'), 'onPress');
    expect(theWebView().props.source?.uri).toBe(FIRST);
    expect(textContents(root)).not.toContain('This page did not finish loading.');
  });

  it('covers the entire content area on failure without covering the address bar', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(web(root), 'onLoadStart', event(FIRST));
    await fire(web(root), 'onError', errorEvent(FIRST));
    const overlay = hostWhere(root, 'View', n => n.props.accessibilityRole === 'alert', 'page error');
    expect(StyleSheet.flatten(overlay.props.style)).toMatchObject(StyleSheet.absoluteFillObject);
    const content = overlay.parent!;
    expect(hosts(content, 'WebView')).toHaveLength(1);
    expect(hosts(content, 'TextInput')).toHaveLength(0);
    expect(StyleSheet.flatten(content.props.style)).toMatchObject({ flex: 1 });
    expect(button(root, 'Reload')).toBeDefined();
    expect(webViewRegistry()).toHaveLength(1);
  });

  it('hides only the failed native page from touch and accessibility, then restores it on retry', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    const nativePage = () => hostWhere(root, 'View',
      n => n.props.collapsable === false && hosts(n, 'WebView').length === 1,
      'native page accessibility boundary');
    expect(nativePage().props.importantForAccessibility).toBe('auto');
    expect(nativePage().props.pointerEvents).toBe('auto');
    await fire(web(root), 'onError', errorEvent(FIRST));
    expect(nativePage().props.importantForAccessibility).toBe('no-hide-descendants');
    expect(nativePage().props.accessibilityElementsHidden).toBe(true);
    expect(nativePage().props.pointerEvents).toBe('none');
    expect(nativePage().findAll(n => n.props.accessibilityLabel === 'Retry page')).toHaveLength(0);
    await fire(button(root, 'Retry page'), 'onPress');
    expect(nativePage().props.importantForAccessibility).toBe('auto');
    expect(nativePage().props.accessibilityElementsHidden).toBe(false);
    expect(nativePage().props.pointerEvents).toBe('auto');
    expect(textContents(root)).not.toContain('This page did not finish loading.');
  });

  it('stops manually and does not surface cancellation as a page failure', async () => {
    Platform.OS = platform;
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(web(root), 'onLoadStart', event(FIRST));
    await fire(button(root, 'Stop loading'), 'onPress');
    expect(theWebView().calls.stop).toBe(1);
    const cancel = platform === 'ios' ? errorEvent(FIRST, -999, 'cancelled')
      : errorEvent(FIRST, -1, 'net::ERR_ABORTED');
    await fire(web(root), 'onError', cancel);
    expect(textContents(root)).not.toContain('This page did not finish loading.');
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
    expect(button(root, 'Reload')).toBeDefined();
  });

  it('keeps TLS failures visible without adding any certificate bypass', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(web(root), 'onLoadStart', event(FIRST));
    await fire(web(root), 'onError', errorEvent(FIRST, -11, 'SSL error'));
    expect(button(root, 'Retry page')).toBeDefined();
    expect(theWebView().props.onHttpError).toBeUndefined();
    expect(theWebView().props.onLoadSubResourceError).toBeUndefined();
    expect(theWebView().calls.injected).toEqual([]);
    expect(theWebView().props.mixedContentMode).toBeUndefined();
  });

  it('ignores stale completed navigation metadata while a later page is pending', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(web(root), 'onLoadStart', event(FIRST));
    await submit(root, SECOND);
    await fire(web(root), 'onLoadStart', event(SECOND));
    await fire(web(root), 'onNavigationStateChange', event(FIRST, false).nativeEvent);
    expect(input(root).props.value).toBe(SECOND);
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(1);
  });

  it('does not overwrite an edit when a popup navigates the background document', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(input(root), 'onFocus');
    await fire(input(root), 'onChangeText', 'keep this draft');
    await actAsync(() => theWebView().emitOpenWindow(SECOND));
    expect(input(root).props.value).toBe('keep this draft');
  });

  it('finishes a redirect that does not emit a second load-start event', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(web(root), 'onLoadStart', event(FIRST));
    await fire(web(root), 'onLoadEnd', event(SECOND, false));
    await fire(web(root), 'onNavigationStateChange', event(SECOND, false).nativeEvent);
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
    expect(input(root).props.value).toBe(SECOND);
  });

  it('accepts a previously visited URL after explicit Back', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(web(root), 'onLoadStart', event(FIRST));
    await fire(web(root), 'onLoadEnd', event(FIRST, false));
    await fire(web(root), 'onLoadStart', event(SECOND));
    await fire(web(root), 'onLoadEnd', event(SECOND, false));
    await navigate(SECOND);
    await fire(button(root, 'Back'), 'onPress');
    await fire(web(root), 'onNavigationStateChange', event(FIRST, false).nativeEvent);
    expect(input(root).props.value).toBe(FIRST);
    expect(theWebView().calls.goBack).toBe(1);
  });

  it('accepts in-page history changes to a previously completed URL without native start', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(web(root), 'onLoadStart', event(FIRST));
    await fire(web(root), 'onLoadEnd', event(FIRST, false));
    await fire(web(root), 'onLoadStart', event(SECOND));
    await fire(web(root), 'onLoadEnd', event(SECOND, false));
    await fire(web(root), 'onNavigationStateChange', event(FIRST, false).nativeEvent);
    expect(input(root).props.value).toBe(FIRST);
  });

  it('finishes a redirect back to an already completed URL without another start', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(web(root), 'onLoadStart', event(FIRST));
    await fire(web(root), 'onLoadEnd', event(FIRST, false));
    await submit(root, SECOND);
    await fire(web(root), 'onLoadStart', event(SECOND));
    await fire(web(root), 'onLoadEnd', event(FIRST, false));
    expect(input(root).props.value).toBe(FIRST);
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
  });

  it.runIf(platform === 'android')('keeps a genuine load pending across an Android history-only callback', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await fire(web(root), 'onLoadStart', event(FIRST));
    await fire(web(root), 'onLoadStart', event(FIRST, false));
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(1);
  });

  it('shows a dismissible slow-load notice without stopping or hiding usable content', async () => {
    vi.useFakeTimers();
    const { root } = await renderScreen(<BrowserScreen />);
    await submit(root, FIRST);
    await actAsync(() => { vi.advanceTimersByTime(30_000); });
    expect(theWebView().calls.stop).toBe(0);
    expect(textContents(root)).toContain('This page is taking longer to load.');
    expect(textContents(root)).not.toContain('This page did not finish loading.');
    expect(button(root, 'Stop loading')).toBeDefined();
    await fire(button(root, 'Dismiss slow loading notice'), 'onPress');
    expect(textContents(root)).not.toContain('This page is taking longer to load.');
    await fire(button(root, 'Stop loading'), 'onPress');
    expect(theWebView().calls.stop).toBe(1);
  });

  it('resets navigation history after a failed-page remount, including hardware Back', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await navigate(FIRST);
    await fire(web(root), 'onLoadStart', event(SECOND));
    await fire(web(root), 'onError', errorEvent(SECOND));
    await fire(button(root, 'Retry page'), 'onPress');
    expect(button(root, 'Back').props.disabled).toBe(true);
    expect(button(root, 'Forward').props.disabled).toBe(true);
    expect(emitHardwareBackPress()).toBe(false);
    expect(theWebView().calls.goBack).toBe(0);
  });

  it('does not treat a provisional navigation callback as a committed document', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    await submit(root, FIRST);
    await fire(web(root), 'onLoadStart', event(FIRST));
    await fire(web(root), 'onNavigationStateChange', event(FIRST, false).nativeEvent);
    await submit(root, FIRST);
    expect(theWebView().calls.reload).toBe(0);
    expect(theWebView().calls.injected).toEqual([`window.location.assign(${JSON.stringify(FIRST)});true;`]);
  });

  it('clears the slow-load timer when loading finishes', async () => {
    vi.useFakeTimers();
    const { root } = await renderScreen(<BrowserScreen />);
    await submit(root, FIRST);
    await fire(web(root), 'onLoadEnd', event(FIRST, false));
    expect(vi.getTimerCount()).toBe(0);
    await actAsync(() => { vi.advanceTimersByTime(30_000); });
    expect(textContents(root)).not.toContain('This page is taking longer to load.');
    expect(theWebView().calls.stop).toBe(0);
  });

  it('clears the slow-load timer on unmount', async () => {
    vi.useFakeTimers();
    const renderer = await renderScreen(<BrowserScreen />);
    await submit(renderer.root, FIRST);
    expect(vi.getTimerCount()).toBe(1);
    await actAsync(() => { renderer.unmount(); });
    expect(vi.getTimerCount()).toBe(0);
  });
});
