import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactTestInstance } from 'react-test-renderer';
import type { WebViewErrorEvent, WebViewNavigation, WebViewNavigationEvent } from 'react-native-webview/lib/WebViewTypes';
import App from '../App';
import { BrowserScreen } from '../src/screens/BrowserScreen';
import { actAsync, fire, hosts, hostWhere, renderScreen, scenes, switchTab, textContents } from './harness';
import { emitHardwareBackPress, Platform } from './mocks/react-native';
import { theWebView, webViewRegistry } from './mocks/react-native-webview';

interface Callbacks {
  onLoadStart: (event: WebViewNavigationEvent) => void;
  onLoadEnd: (event: WebViewNavigationEvent | WebViewErrorEvent) => void;
  onError: (event: WebViewErrorEvent) => void;
  onNavigationStateChange: (state: WebViewNavigation) => void;
}

// Run the pinned dependency's JS dispatch order against the real screen.
// Native WebView/network delivery is still a controlled boundary, not executed.
// Each driver keeps one hook probe across WebView remounts and forwards events
// to the currently mounted view. It cannot deliver events from an unmounted
// instance; viewState/lastErrorEvent describe the probe, not a fresh native-view
// hook after Retry. Native focus/blur and per-mount wrapper state are not tested.
const { useWebViewLogic } = await vi.importActual<{
  useWebViewLogic: (options: Callbacks & {
    originWhitelist: string[];
    onShouldStartLoadWithRequestCallback: () => void;
  }) => {
    onLoadingStart: (event: WebViewNavigationEvent) => void;
    onLoadingFinish: (event: WebViewNavigationEvent) => void;
    onLoadingError: (event: WebViewErrorEvent) => void;
    viewState: string;
    lastErrorEvent: unknown;
  };
}>('../node_modules/react-native-webview/src/WebViewShared');

const FIRST = 'https://example.test/first';
const SECOND = 'https://example.test/second';
const ERROR = 'This page did not finish loading.';
const SLOW = 'This page is taking longer to load.';
const input = (root: ReactTestInstance) => hostWhere(root, 'TextInput',
  n => n.props.placeholder === 'Search or enter address', 'address');
const button = (root: ReactTestInstance, label: string) => hostWhere(root, 'TouchableOpacity',
  n => n.props.accessibilityLabel === label, label);
const event = (url: string, loading: boolean) => ({
  nativeEvent: { url, loading, canGoBack: true, canGoForward: false, title: '', target: 1 },
}) as unknown as WebViewNavigationEvent;
const failure = (url: string, code = -2, description = 'network failure') => {
  let prevented = false;
  return {
    nativeEvent: { ...event(url, false).nativeEvent, code, description },
    persist: vi.fn(),
    preventDefault: () => { prevented = true; },
    isDefaultPrevented: () => prevented,
  } as unknown as WebViewErrorEvent;
};

async function submit(root: ReactTestInstance, url: string) {
  await fire(input(root), 'onChangeText', url);
  await fire(input(root), 'onSubmitEditing');
}

async function driver() {
  let logic!: ReturnType<typeof useWebViewLogic>;
  const callbacks = () => theWebView().props as unknown as Callbacks;
  function Probe() {
    logic = useWebViewLogic({
      originWhitelist: ['http://*', 'https://*'],
      onShouldStartLoadWithRequestCallback: vi.fn(),
      onLoadStart: event => callbacks().onLoadStart(event),
      onLoadEnd: event => callbacks().onLoadEnd(event),
      onError: event => callbacks().onError(event),
      onNavigationStateChange: state => callbacks().onNavigationStateChange(state),
    });
    return null;
  }
  await renderScreen(<Probe />);
  return {
    start: (url: string) => actAsync(() => logic.onLoadingStart(event(url, true))),
    finish: (url: string) => actAsync(() => logic.onLoadingFinish(event(url, false))),
    error: (event: WebViewErrorEvent) => actAsync(() => logic.onLoadingError(event)),
    state: () => logic,
  };
}

describe.each(['android', 'ios'] as const)('browser event ordering on %s', platform => {
  beforeEach(() => { Platform.OS = platform; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it.each(['finish', 'failure', 'cancellation'] as const)(
    'keeps the replacement load pending after Stop and a delayed %s', async late => {
      const { root } = await renderScreen(<BrowserScreen />);
      const native = await driver();
      await submit(root, FIRST);
      await native.start(FIRST);
      await fire(button(root, 'Stop loading'), 'onPress');
      expect(vi.getTimerCount()).toBe(0);
      await submit(root, SECOND);
      await native.start(SECOND);
      if (late === 'finish') await native.finish(FIRST);
      else {
        // RNCWebViewClient.onReceivedError emits a finish before its error.
        if (platform === 'android') await native.finish(FIRST);
        const error = late === 'failure' ? failure(FIRST)
          : failure(FIRST, platform === 'ios' ? -999 : -1, 'net::ERR_ABORTED');
        await native.error(error);
        expect(error.isDefaultPrevented()).toBe(true);
      }
      expect(textContents(root)).not.toContain(ERROR);
      expect(input(root).props.value).toBe(SECOND);
      expect(hosts(root, 'ActivityIndicator')).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(1);
      expect(native.state().viewState).toBe('IDLE');
      expect(native.state().lastErrorEvent).toBeNull();
      await actAsync(() => { vi.advanceTimersByTime(30_000); });
      expect(textContents(root)).toContain(SLOW);
      await native.finish(SECOND);
      expect(textContents(root)).not.toContain(SLOW);
      expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
      expect(theWebView().calls.stop).toBe(1);
      expect(webViewRegistry()).toHaveLength(1);
    },
  );

  it('allows an explicitly resubmitted stopped URL to fail and be retried', async () => {
    const { root } = await renderScreen(<BrowserScreen />);
    const native = await driver();
    await submit(root, FIRST);
    await native.start(FIRST);
    await fire(button(root, 'Stop loading'), 'onPress');
    await submit(root, SECOND);
    await native.start(SECOND);
    await submit(root, FIRST);
    await native.start(FIRST);
    await native.error(failure(FIRST));
    expect(textContents(root)).toContain(ERROR);
    expect(vi.getTimerCount()).toBe(0);
    const previous = theWebView();
    await fire(button(root, 'Retry page'), 'onPress');
    expect(previous.mounted).toBe(false);
    expect(theWebView().props.source?.uri).toBe(FIRST);
    await native.start(FIRST);
    await native.finish(FIRST);
    expect(textContents(root)).not.toContain(ERROR);
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
  });

  it.each(['finish', 'failure', 'cancellation'] as const)('ignores delayed %s before the replacement native start arrives', async late => {
    const { root } = await renderScreen(<BrowserScreen />);
    const native = await driver();
    await submit(root, FIRST);
    await native.start(FIRST);
    await fire(button(root, 'Stop loading'), 'onPress');
    await submit(root, SECOND);
    if (late === 'finish') await native.finish(FIRST);
    else {
      if (platform === 'android') await native.finish(FIRST);
      const error = late === 'failure' ? failure(FIRST)
        : failure(FIRST, platform === 'ios' ? -999 : -1, 'net::ERR_ABORTED');
      await native.error(error);
      expect(error.isDefaultPrevented()).toBe(true);
    }
    expect(textContents(root)).not.toContain(ERROR);
    expect(input(root).props.value).toBe(SECOND);
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(1);
    expect(button(root, 'Stop loading')).toBeDefined();
    await actAsync(() => { vi.advanceTimersByTime(29_999); });
    expect(textContents(root)).not.toContain(SLOW);
    expect(vi.getTimerCount()).toBe(1);
    await actAsync(() => { vi.advanceTimersByTime(1); });
    expect(textContents(root)).toContain(SLOW);
    await native.start(SECOND);
    expect(textContents(root)).not.toContain(SLOW);
    await native.finish(SECOND);
    expect(input(root).props.value).toBe(SECOND);
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
    expect(textContents(root)).not.toContain(ERROR);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { direction: 'Back', traversal: 'same-document' },
    { direction: 'Forward', traversal: 'same-document' },
    { direction: 'Back', traversal: 'cross-document' },
    { direction: 'Forward', traversal: 'cross-document' },
  ])('accepts stopped URLs again after explicit $traversal $direction', async ({ direction, traversal }) => {
    const { root } = await renderScreen(<BrowserScreen />);
    const native = await driver();
    await submit(root, FIRST);
    await native.start(FIRST);
    await fire(button(root, 'Stop loading'), 'onPress');
    await submit(root, SECOND);
    await native.start(SECOND);
    await native.finish(SECOND);
    const web = hostWhere(root, 'WebView', () => true, 'webview');
    await fire(web, 'onNavigationStateChange', {
      ...event(SECOND, false).nativeEvent, canGoForward: true,
    });
    await fire(button(root, direction), 'onPress');
    if (traversal === 'cross-document') {
      // The real hook forwards start + navigation, then end + navigation.
      await native.start(FIRST);
      expect(hosts(root, 'ActivityIndicator')).toHaveLength(1);
      await native.finish(FIRST);
    } else {
      // A same-document history traversal need not emit a load-start callback.
      await fire(web, 'onNavigationStateChange', event(FIRST, false).nativeEvent);
    }
    expect(input(root).props.value).toBe(FIRST);
    expect(theWebView().calls[direction === 'Back' ? 'goBack' : 'goForward']).toBe(1);
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
    expect(textContents(root)).not.toContain(ERROR);
    expect(vi.getTimerCount()).toBe(0);
    expect(webViewRegistry()).toHaveLength(1);
  });

  it.each([-999, 102])('treats error code %s as cancellation only on iOS', async code => {
    const { root } = await renderScreen(<BrowserScreen />);
    const native = await driver();
    await submit(root, FIRST);
    await native.start(FIRST);
    await native.error(failure(FIRST, code));
    expect(textContents(root).includes(ERROR)).toBe(platform !== 'ios');
    expect(hosts(root, 'ActivityIndicator')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(native.state().lastErrorEvent).toBeNull();
  });

  it.each(['finish', 'failure'] as const)('preserves an address draft across background %s', async outcome => {
    const { root } = await renderScreen(<App />);
    const native = await driver();
    await submit(root, FIRST);
    await native.start(FIRST);
    await fire(input(root), 'onFocus');
    await fire(input(root), 'onChangeText', 'unfinished query');
    await switchTab(root, 'Chat');
    // Keyboard dismissal is mocked; no native focus/blur behavior is claimed.
    if (outcome === 'finish') await native.finish(SECOND);
    else await native.error(failure(FIRST));
    expect(emitHardwareBackPress()).toBe(false);
    expect(scenes(root)[0].props.pointerEvents).toBe('none');
    expect(scenes(root)[0].props.accessibilityElementsHidden).toBe(true);
    await switchTab(root, 'Browse');
    expect(input(root).props.value).toBe('unfinished query');
    expect(webViewRegistry()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    if (outcome === 'failure') {
      const page = hostWhere(root, 'View', n => n.props.collapsable === false &&
        n.props.importantForAccessibility === 'no-hide-descendants' && hosts(n, 'WebView').length === 1 &&
        n.props.pointerEvents === 'none', 'failed native page');
      expect(page.props.accessibilityElementsHidden).toBe(true);
      await fire(input(root), 'onSubmitEditing');
      expect(theWebView().props.source?.uri).toBe('https://duckduckgo.com/?q=unfinished%20query');
      expect(textContents(root)).not.toContain(ERROR);
      expect(button(root, 'Back').props.disabled).toBe(true);
      expect(webViewRegistry()).toHaveLength(2);
    } else {
      await fire(input(root), 'onBlur');
      expect(input(root).props.value).toBe(SECOND);
    }
  });

  it('keeps a slow background document mounted and lets Stop clear its notice and timer', async () => {
    const { root } = await renderScreen(<App />);
    const native = await driver();
    await submit(root, FIRST);
    await native.start(FIRST);
    await switchTab(root, 'Settings');
    await actAsync(() => { vi.advanceTimersByTime(30_000); });
    expect(scenes(root)[0].props.pointerEvents).toBe('none');
    expect(textContents(root)).toContain(SLOW);
    await switchTab(root, 'Browse');
    await fire(button(root, 'Stop loading'), 'onPress');
    await native.error(failure(FIRST, -1, 'net::ERR_ABORTED'));
    expect(textContents(root)).not.toContain(SLOW);
    expect(textContents(root)).not.toContain(ERROR);
    expect(vi.getTimerCount()).toBe(0);
    expect(theWebView().calls.stop).toBe(1);
    expect(webViewRegistry()).toHaveLength(1);
  });
});
