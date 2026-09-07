/**
 * Android edge-to-edge: the shell consumes real inset values from
 * react-native-safe-area-context — status-bar inset above the toolbar, gesture
 * bar inset below the tabs — instead of React Native's removed-from-here,
 * iOS-only SafeAreaView.
 */
import { describe, expect, it } from 'vitest';
import App from '../App';
import { flat, hosts, hostWhere, isHostType, renderScreen } from './harness';
import { setMockSafeAreaInsets } from './mocks/react-native-safe-area-context';

import type { ReactTestInstance } from 'react-test-renderer';

const shellRoot = (root: ReactTestInstance) => hosts(root, 'View')[0];

const tabBar = (root: ReactTestInstance) =>
  hostWhere(
    root,
    'View',
    (n) =>
      flat(n).flexDirection === 'row' &&
      n.findAll((t) => isHostType(t, 'TouchableOpacity') && t.props.accessibilityRole === 'tab')
        .length === 4,
    'tab bar',
  );

describe('safe-area handling', () => {
  it('pads the shell and tab bar by the reported system-bar insets', async () => {
    setMockSafeAreaInsets({ top: 37, right: 12, bottom: 48, left: 12 });
    const renderer = await renderScreen(<App />);

    const rootStyle = flat(shellRoot(renderer.root));
    expect(rootStyle.paddingTop).toBe(37);
    expect(rootStyle.paddingLeft).toBe(12);
    expect(rootStyle.paddingRight).toBe(12);

    expect(flat(tabBar(renderer.root)).paddingBottom).toBe(6 + 48);
  });

  it('keeps the base tab-bar spacing when insets are zero', async () => {
    const renderer = await renderScreen(<App />);
    expect(flat(shellRoot(renderer.root)).paddingTop).toBe(0);
    expect(flat(tabBar(renderer.root)).paddingBottom).toBe(6);
  });
});
