import { expect, it, vi } from 'vitest';
import type { WebViewErrorEvent } from 'react-native-webview/lib/WebViewTypes';
import { actAsync, renderScreen } from './harness';

// Execute the dependency's hook, not our native-boundary double. Loading it
// at runtime avoids typechecking the package's unpublished source dependencies.
const { useWebViewLogic } = await vi.importActual<{
  useWebViewLogic: (options: {
    originWhitelist: string[];
    onShouldStartLoadWithRequestCallback: () => void;
    onError: (event: WebViewErrorEvent) => void;
    onLoadEnd: () => void;
  }) => {
    onLoadingError: (event: WebViewErrorEvent) => void;
    viewState: string;
    lastErrorEvent: unknown;
  };
}>('../node_modules/react-native-webview/src/WebViewShared');

it('the pinned WebView honors preventDefault after forwarding the error and load end', async () => {
  let logic!: ReturnType<typeof useWebViewLogic>;
  const order: string[] = [];
  function Probe() {
    logic = useWebViewLogic({
      originWhitelist: ['http://*', 'https://*'],
      onShouldStartLoadWithRequestCallback: vi.fn(),
      onError: event => { order.push('error'); event.preventDefault(); },
      onLoadEnd: () => { order.push('end'); },
    });
    return null;
  }
  await renderScreen(<Probe />);
  let prevented = false;
  const event = {
    nativeEvent: { url: 'https://example.test', code: -2, description: 'network failure' },
    persist: vi.fn(),
    preventDefault: () => { prevented = true; },
    isDefaultPrevented: () => prevented,
  } as unknown as WebViewErrorEvent;
  await actAsync(() => { logic.onLoadingError(event); });
  expect(order).toEqual(['error', 'end']);
  expect(logic.viewState).toBe('IDLE');
  expect(logic.lastErrorEvent).toBeNull();
});
