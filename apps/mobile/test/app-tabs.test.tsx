/**
 * Tab shell behavior through the real App component: every screen stays
 * mounted across tab switches — WebView identity, browser address state, chat
 * history, and the chat draft all survive — while inactive scenes are hidden
 * from touch, accessibility, and the visible layout.
 */
import { describe, expect, it, vi } from 'vitest';
import App from '../App';
import {
  actAsync,
  fire,
  flat,
  hosts,
  hostWhere,
  isHostType,
  renderScreen,
  scenes,
  switchTab,
  textContents,
} from './harness';
import { theWebView, webViewRegistry } from './mocks/react-native-webview';
import { Keyboard } from './mocks/react-native';

import type { ReactTestInstance } from 'react-test-renderer';

const addressInput = (root: ReactTestInstance) =>
  hostWhere(root, 'TextInput', (n) => n.props.placeholder === 'Search or enter address', 'address bar');

const chatInput = (root: ReactTestInstance) =>
  hostWhere(
    root,
    'TextInput',
    (n) => n.props.placeholder === 'Message' || n.props.placeholder === 'Thinking…',
    'chat composer',
  );

const sendButton = (root: ReactTestInstance) =>
  hostWhere(
    root,
    'TouchableOpacity',
    (n) => n.findAll((t) => isHostType(t, 'Text') && t.props.children === 'Send').length === 1,
    'send button',
  );

describe('App tab shell', () => {
  it('dismisses the old tab keyboard only when changing tabs', async () => {
    const renderer = await renderScreen(<App />);
    await switchTab(renderer.root, 'Browse');
    expect(Keyboard.dismiss).not.toHaveBeenCalled();
    await switchTab(renderer.root, 'Chat');
    expect(Keyboard.dismiss).toHaveBeenCalledTimes(1);
    await switchTab(renderer.root, 'Browse');
    expect(Keyboard.dismiss).toHaveBeenCalledTimes(2);
  });
  it('keeps all four screens mounted at once', async () => {
    const renderer = await renderScreen(<App />);
    const root = renderer.root;

    // One browser (address bar + WebView), one chat composer, and the agents +
    // settings content — all present in the tree simultaneously.
    expect(addressInput(root)).toBeDefined();
    expect(chatInput(root)).toBeDefined();
    expect(textContents(root)).toContain('Agents');
    expect(textContents(root)).toContain('Settings');
    expect(webViewRegistry()).toHaveLength(1);
    expect(scenes(root)).toHaveLength(4);
  });

  it('exposes only the active scene to touch and accessibility', async () => {
    const renderer = await renderScreen(<App />);
    const root = renderer.root;

    const [browser, chat, agents, settings] = scenes(root);
    expect(browser.props.accessibilityElementsHidden).toBe(false);
    expect(browser.props.importantForAccessibility).toBe('auto');
    expect(browser.props.pointerEvents).toBe('auto');
    for (const hidden of [chat, agents, settings]) {
      expect(hidden.props.accessibilityElementsHidden).toBe(true);
      expect(hidden.props.importantForAccessibility).toBe('no-hide-descendants');
      expect(hidden.props.pointerEvents).toBe('none');
    }

    // Hidden scenes are parked offscreen inside an overflow-hidden host — not
    // display:none (native detach risk), not unmounted (state destruction).
    // findAll() includes the node itself, so skip the scene wrapper.
    const innerOf = (scene: ReactTestInstance) =>
      hosts(scene, 'View').find((view) => view !== scene)!;
    expect(flat(browser).overflow).toBe('hidden');
    expect(flat(browser).position).toBe('absolute');
    expect(flat(innerOf(browser)).top).toBeUndefined();
    expect(flat(innerOf(chat)).top).toBe(100000);

    await switchTab(root, 'Chat');
    const after = scenes(root);
    expect(after[0].props.accessibilityElementsHidden).toBe(true);
    expect(after[1].props.accessibilityElementsHidden).toBe(false);
    expect(flat(innerOf(after[0])).top).toBe(100000);
    expect(flat(innerOf(after[1])).top).toBeUndefined();
  });

  it('keeps the same WebView (history intact) across tab switches', async () => {
    const renderer = await renderScreen(<App />);
    const root = renderer.root;

    const initialId = theWebView().id;
    await actAsync(() =>
      theWebView().emitNavigationState({
        url: 'https://example.com/second-page',
        canGoBack: true,
        canGoForward: false,
      }),
    );

    await switchTab(root, 'Chat');
    await switchTab(root, 'Settings');
    await switchTab(root, 'Browse');

    // A remount would appear as a second registry entry and reset the address
    // bar and the Back button to their initial state.
    expect(webViewRegistry()).toHaveLength(1);
    expect(theWebView().id).toBe(initialId);
    expect(addressInput(root).props.value).toBe('https://example.com/second-page');
    const backButton = hostWhere(
      root,
      'TouchableOpacity',
      (n) => n.props.accessibilityLabel === 'Back',
      'browser back button',
    );
    expect(backButton.props.accessibilityState).toEqual({ disabled: false });
  });

  it('keeps chat history and the unsent draft across tab switches', async () => {
    vi.useFakeTimers();
    try {
      const renderer = await renderScreen(<App />);
      const root = renderer.root;

      await switchTab(root, 'Chat');
      await fire(chatInput(root), 'onChangeText', 'hello agent');
      await fire(sendButton(root), 'onPress');
      // The offline AI seam replies after 350ms (src/lib/ai.ts).
      await actAsync(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      const sent = textContents(root);
      expect(sent).toContain('hello agent');
      expect(sent.some((text) => text.includes('You said: “hello agent”'))).toBe(true);

      await fire(chatInput(root), 'onChangeText', 'unsent draft');
      await switchTab(root, 'Agents');
      await switchTab(root, 'Chat');

      // A remounted ChatScreen would come back with only the greeting bubble
      // and an empty composer.
      const restored = textContents(root);
      expect(restored).toContain('hello agent');
      expect(restored.some((text) => text.includes('You said: “hello agent”'))).toBe(true);
      expect(chatInput(root).props.value).toBe('unsent draft');
    } finally {
      vi.useRealTimers();
    }
  });
});
