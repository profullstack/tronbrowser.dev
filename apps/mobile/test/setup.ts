/**
 * Vitest setup: declare the React act() environment, polyfill
 * requestAnimationFrame (Node has none; the chat screen scrolls with it), and
 * reset every controllable native mock between tests.
 */
import { afterEach } from 'vitest';
import { cleanupRenderers } from './harness';
import { Keyboard, Platform, resetBackHandlerMock } from './mocks/react-native';
import { resetMockSafeAreaInsets } from './mocks/react-native-safe-area-context';
import { resetWebViewRegistry } from './mocks/react-native-webview';

const globals = globalThis as Record<string, unknown>;

globals.IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globals.requestAnimationFrame !== 'function') {
  globals.requestAnimationFrame = (callback: (time: number) => void) =>
    setTimeout(() => callback(Date.now()), 0);
  globals.cancelAnimationFrame = (id: unknown) =>
    clearTimeout(id as Parameters<typeof clearTimeout>[0]);
}

afterEach(async () => {
  await cleanupRenderers();
  resetBackHandlerMock();
  resetWebViewRegistry();
  resetMockSafeAreaInsets();
  Platform.OS = 'android';
  Keyboard.dismiss.mockClear();
});
