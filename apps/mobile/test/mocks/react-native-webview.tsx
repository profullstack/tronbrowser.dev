/**
 * Test double for `react-native-webview` (aliased in vitest.config.ts).
 *
 * Each mounted WebView registers a handle so tests can drive the native side
 * of the boundary — emit navigation-state / open-window events — and observe
 * goBack/goForward/reload calls. Handles are never pruned from the registry,
 * so an accidental remount (which would destroy real WebView history) is
 * visible as a second entry.
 */
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface MockNavigationState {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface MockWebViewProps {
  source?: { uri?: string };
  onLoadStart?: () => void;
  onLoadEnd?: () => void;
  onNavigationStateChange?: (state: MockNavigationState) => void;
  onOpenWindow?: (event: { nativeEvent: { targetUrl: string } }) => void;
  [prop: string]: unknown;
}

export interface MockWebViewHandle {
  id: number;
  mounted: boolean;
  /** Props from the most recent render. */
  props: MockWebViewProps;
  calls: { goBack: number; goForward: number; reload: number; injected: string[] };
  emitNavigationState(state: MockNavigationState): void;
  emitOpenWindow(targetUrl: string): void;
}

const registry: MockWebViewHandle[] = [];
let nextId = 1;

/** Every WebView ever mounted in the current test, in mount order. */
export function webViewRegistry(): readonly MockWebViewHandle[] {
  return registry;
}

/** The single live WebView; throws if there is not exactly one. */
export function theWebView(): MockWebViewHandle {
  const mounted = registry.filter((handle) => handle.mounted);
  if (mounted.length !== 1) {
    throw new Error(`expected exactly one mounted WebView, found ${mounted.length}`);
  }
  return mounted[0];
}

export function resetWebViewRegistry(): void {
  registry.length = 0;
  nextId = 1;
}

export const WebView = forwardRef<unknown, MockWebViewProps>(function WebView(props, ref) {
  const handleRef = useRef<MockWebViewHandle | null>(null);
  if (handleRef.current === null) {
    const handle: MockWebViewHandle = {
      id: nextId++,
      mounted: true,
      props,
      calls: { goBack: 0, goForward: 0, reload: 0, injected: [] },
      emitNavigationState(state) {
        handle.props.onNavigationStateChange?.(state);
      },
      emitOpenWindow(targetUrl) {
        handle.props.onOpenWindow?.({ nativeEvent: { targetUrl } });
      },
    };
    handleRef.current = handle;
    registry.push(handle);
  }
  handleRef.current.props = props;

  useEffect(() => {
    const handle = handleRef.current;
    if (handle) handle.mounted = true;
    return () => {
      if (handle) handle.mounted = false;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => {
      handleRef.current!.calls.injected.push(script);
    },
    goBack: () => {
      handleRef.current!.calls.goBack += 1;
    },
    goForward: () => {
      handleRef.current!.calls.goForward += 1;
    },
    reload: () => {
      handleRef.current!.calls.reload += 1;
    },
  }));

  return createElement('WebView', props);
});
