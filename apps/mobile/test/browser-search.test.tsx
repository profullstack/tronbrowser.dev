/**
 * Search through the real BrowserScreen: address-bar input must reach the
 * actual WebView `source` as a no-account DuckDuckGo query — the same
 * correction the desktop launcher already ships — never as Kagi and never as a
 * raw unsupported scheme.
 */
import { describe, expect, it } from 'vitest';
import { HOME } from '../src/lib/navigation';
import { BrowserScreen } from '../src/screens/BrowserScreen';
import { fire, hostWhere, renderScreen } from './harness';
import { theWebView } from './mocks/react-native-webview';

import type { ReactTestInstance } from 'react-test-renderer';

const addressInput = (root: ReactTestInstance) =>
  hostWhere(root, 'TextInput', (n) => n.props.placeholder === 'Search or enter address', 'address bar');

async function submitAddress(root: ReactTestInstance, text: string): Promise<void> {
  await fire(addressInput(root), 'onChangeText', text);
  await fire(addressInput(root), 'onSubmitEditing');
}

describe('BrowserScreen search', () => {
  it('starts on the TronBrowser home page', async () => {
    await renderScreen(<BrowserScreen />);
    expect(theWebView().props.source).toEqual({ uri: HOME });
  });

  it('sends plain text to DuckDuckGo, which needs no account', async () => {
    const renderer = await renderScreen(<BrowserScreen />);
    await submitAddress(renderer.root, 'privacy first browser');
    expect(theWebView().props.source).toEqual({
      uri: 'https://duckduckgo.com/?q=privacy%20first%20browser',
    });
    expect(addressInput(renderer.root).props.value).toBe(
      'https://duckduckgo.com/?q=privacy%20first%20browser',
    );
  });

  it('promotes a bare domain to HTTPS instead of searching it', async () => {
    const renderer = await renderScreen(<BrowserScreen />);
    await submitAddress(renderer.root, 'docs.example.com/guide');
    expect(theWebView().props.source).toEqual({ uri: 'https://docs.example.com/guide' });
  });

  it('turns javascript: input into a search, never a load', async () => {
    const renderer = await renderScreen(<BrowserScreen />);
    await submitAddress(renderer.root, 'javascript:alert(1)');
    expect(theWebView().props.source).toEqual({
      uri: 'https://duckduckgo.com/?q=javascript%3Aalert(1)',
    });
  });
});
