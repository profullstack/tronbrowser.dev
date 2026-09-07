/**
 * Test double for the `react-native` module (aliased in vitest.config.ts).
 *
 * View/Text/… are exported as host-element type strings so react-test-renderer
 * shows the app's real rendered tree one node per component, and the imperative
 * APIs the app touches (BackHandler, Platform, Linking) are controllable from
 * tests through the extra mock-only exports at the bottom.
 */
import {
  Fragment,
  createElement,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
} from 'react';
import { vi } from 'vitest';

export const View = 'View';
export const Text = 'Text';
export const TextInput = 'TextInput';
export const TouchableOpacity = 'TouchableOpacity';
export const ScrollView = 'ScrollView';
export const ActivityIndicator = 'ActivityIndicator';
export const KeyboardAvoidingView = 'KeyboardAvoidingView';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

/** Renders every row like the real list, and honors the scrollToEnd ref. */
export const FlatList = forwardRef<unknown, AnyProps>(function FlatList(props, ref) {
  useImperativeHandle(ref, () => ({
    scrollToEnd: (_options?: { animated?: boolean }) => {},
  }));
  const data = (props.data as readonly unknown[] | undefined) ?? [];
  const renderItem = props.renderItem as
    | ((info: { item: unknown; index: number }) => ReactNode)
    | undefined;
  const keyExtractor = props.keyExtractor as
    | ((item: unknown, index: number) => string)
    | undefined;
  const header = props.ListHeaderComponent as ReactNode | (() => ReactNode) | undefined;
  return createElement(
    'FlatList',
    props,
    typeof header === 'function' ? createElement(header) : header ?? null,
    data.map((item, index) =>
      createElement(
        Fragment,
        { key: keyExtractor ? keyExtractor(item, index) : String(index) },
        renderItem ? renderItem({ item, index }) : null,
      ),
    ),
  );
});

type StyleValue =
  | Record<string, unknown>
  | false
  | null
  | undefined
  | readonly StyleValue[];

function flatten(style: StyleValue): Record<string, unknown> {
  if (!style) return {};
  if (Array.isArray(style)) {
    const merged: Record<string, unknown> = {};
    for (const entry of style as readonly StyleValue[]) Object.assign(merged, flatten(entry));
    return merged;
  }
  return style as Record<string, unknown>;
}

export const StyleSheet = {
  absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  hairlineWidth: 1,
  create<T>(styles: T): T {
    return styles;
  },
  flatten,
};

export const Platform = {
  OS: 'android' as 'android' | 'ios',
  select<T>(spec: Partial<Record<'android' | 'ios' | 'default', T>>): T | undefined {
    const chosen = spec[Platform.OS];
    return chosen !== undefined ? chosen : spec.default;
  },
};

export const Linking = {
  openURL: async (_url: string): Promise<void> => {},
};

export const Keyboard = { dismiss: vi.fn() };

type BackPressHandler = () => boolean;
const backPressHandlers: BackPressHandler[] = [];

export const BackHandler = {
  addEventListener(_event: 'hardwareBackPress', handler: BackPressHandler) {
    backPressHandlers.push(handler);
    return {
      remove() {
        const index = backPressHandlers.indexOf(handler);
        if (index !== -1) backPressHandlers.splice(index, 1);
      },
    };
  },
  exitApp() {},
};

// --- mock-only test controls ------------------------------------------------

/**
 * Fire the Android hardware back event the way React Native does: most recent
 * handler first, stop at the first `true`. Returns whether any handler consumed
 * it — `false` means the OS would background/exit the app.
 */
export function emitHardwareBackPress(): boolean {
  for (let i = backPressHandlers.length - 1; i >= 0; i--) {
    if (backPressHandlers[i]()) return true;
  }
  return false;
}

/** Live hardwareBackPress subscriptions — for asserting cleanup, not behavior. */
export function backPressSubscriptionCount(): number {
  return backPressHandlers.length;
}

export function resetBackHandlerMock(): void {
  backPressHandlers.length = 0;
}
