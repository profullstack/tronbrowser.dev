/**
 * Bonus scope: honest third-party-cookie wording. The blocking flag
 * (`thirdPartyCookiesEnabled={false}`) exists on Android's WebView only, so
 * only the Android UI may claim blocking; iOS states that WebKit decides.
 */
import { describe, expect, it } from 'vitest';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { BrowserScreen } from '../src/screens/BrowserScreen';
import { renderScreen, textContents } from './harness';
import { Platform } from './mocks/react-native';
import { theWebView } from './mocks/react-native-webview';

describe('third-party cookie wording', () => {
  it('claims blocking on Android, where the WebView flag really applies', async () => {
    Platform.OS = 'android';
    const settings = await renderScreen(<SettingsScreen />);
    expect(textContents(settings.root)).toContain('Blocked in browser tab');

    await renderScreen(<BrowserScreen />);
    expect(theWebView().props.thirdPartyCookiesEnabled).toBe(false);
  });

  it('does not claim app-side blocking on iOS', async () => {
    Platform.OS = 'ios';
    const settings = await renderScreen(<SettingsScreen />);
    const rendered = textContents(settings.root);
    expect(rendered).toContain('Decided by iOS WebKit');
    expect(rendered).not.toContain('Blocked in browser tab');
  });

  it('shows the app version from the Expo config seam', async () => {
    const settings = await renderScreen(<SettingsScreen />);
    expect(textContents(settings.root)).toContain('0.0.0-test');
  });
});
