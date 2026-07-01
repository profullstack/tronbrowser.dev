import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { theme } from '../theme';

/**
 * In-app browser tab.
 *
 * NOTE: this uses `react-native-webview`, i.e. the *system* engine — WebKit on
 * iOS (mandatory), the system WebView on Android. It is deliberately NOT the
 * Ungoogled Chromium engine (see docs/mobile-architecture.md — the engine ships
 * via the native Android build and the Linux-phone desktop build, not Expo).
 */
const HOME = 'https://tronbrowser.dev';

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return HOME;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // A bare domain-looking string → https; otherwise treat as a search query.
  if (/^[\w-]+(\.[\w-]+)+/.test(trimmed)) return `https://${trimmed}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

export function BrowserScreen() {
  const webRef = useRef<WebView>(null);
  const [address, setAddress] = useState(HOME);
  const [uri, setUri] = useState(HOME);
  const [loading, setLoading] = useState(false);

  const go = () => {
    const next = normalizeUrl(address);
    setUri(next);
    setAddress(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => webRef.current?.goBack()}
          accessibilityLabel="Back"
        >
          <Text style={styles.navBtnText}>‹</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={address}
          onChangeText={setAddress}
          onSubmitEditing={go}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          placeholder="Search or enter address"
          placeholderTextColor={theme.textDim}
          selectTextOnFocus
        />
        <TouchableOpacity style={styles.navBtn} onPress={go} accessibilityLabel="Reload">
          <Text style={styles.navBtnText}>⟳</Text>
        </TouchableOpacity>
      </View>
      {loading && (
        <ActivityIndicator style={styles.spinner} color={theme.accent} size="small" />
      )}
      <WebView
        ref={webRef}
        source={{ uri }}
        style={styles.web}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={(s) => setAddress(s.url)}
        // Privacy-leaning defaults consistent with the desktop ethos.
        thirdPartyCookiesEnabled={false}
        allowsInlineMediaPlayback
        pullToRefreshEnabled={Platform.OS === 'ios'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
    backgroundColor: theme.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceAlt,
  },
  navBtnText: { color: theme.accent, fontSize: 18, fontWeight: '700' },
  input: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: theme.text,
    backgroundColor: theme.surfaceAlt,
  },
  spinner: { position: 'absolute', top: 56, alignSelf: 'center', zIndex: 2 },
  web: { flex: 1, backgroundColor: theme.bg },
});
