import { describe, expect, it } from 'vitest';
import App from '../App';
import { flat, hosts, renderScreen, scenes, tabButton } from './harness';
import { Platform } from './mocks/react-native';
import { setMockSafeAreaInsets } from './mocks/react-native-safe-area-context';

// Native geometry is exercised separately with the APK. These tests pin the
// platform wiring so mocked native components cannot claim to prove IME layout.
describe('shell keyboard avoidance', () => {
  it('resizes the Android shell containing the scenes and tabs', async () => {
    const renderer = await renderScreen(<App />);
    const shell = hosts(renderer.root, 'KeyboardAvoidingView').find(
      (node) => node.props.enabled === true,
    );
    expect(shell).toBeDefined();
    expect(shell!.props.behavior).toBe('height');
    expect(shell!.props.keyboardVerticalOffset).toBe(0);
    expect(scenes(shell!)).toHaveLength(4);
    expect(tabButton(shell!, 'Chat')).toBeDefined();
  });

  it('keeps system insets inside the keyboard-aware root without a second offset', async () => {
    setMockSafeAreaInsets({ top: 37, right: 12, bottom: 48, left: 12 });
    const renderer = await renderScreen(<App />);
    const shell = hosts(renderer.root, 'KeyboardAvoidingView').find(
      (node) => node.props.enabled === true,
    );
    expect(shell).toBeDefined();
    expect(flat(shell!)).toMatchObject({ paddingTop: 37, paddingLeft: 12, paddingRight: 12 });
    expect(shell!.props.keyboardVerticalOffset).toBe(0);
  });

  it('does not add a second keyboard adjustment to the existing iOS chat', async () => {
    Platform.OS = 'ios';
    const renderer = await renderScreen(<App />);
    const views = hosts(renderer.root, 'KeyboardAvoidingView');
    const shell = views.find((node) => node.props.enabled === false);
    expect(shell).toBeDefined();
    expect(shell!.props.behavior).toBeUndefined();
    expect(views.some((node) => node.props.behavior === 'padding')).toBe(true);
  });
});
