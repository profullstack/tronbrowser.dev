import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { HOME, navigableHttpUrl, normalizeUrl } from '../lib/navigation';
import { theme } from '../theme';

/**
 * In-app browser tab.
 *
 * NOTE: this uses `react-native-webview`, i.e. the *system* engine — WebKit on
 * iOS (mandatory), the system WebView on Android. It is deliberately NOT the
 * Ungoogled Chromium engine (see docs/mobile-architecture.md — the engine ships
 * via the native Android build and the Linux-phone desktop build, not Expo).
 *
 * The screen stays mounted while other tabs are shown (App.tsx keeps every
 * scene alive), so `isActive` — not mount state — says whether this tab owns
 * the Android hardware Back button.
 */
export function BrowserScreen({ isActive = true }: { isActive?: boolean }) {
  const webRef = useRef<WebView>(null);
  const [address, setAddress] = useState(HOME);
  const [uri, setUri] = useState(HOME);
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  // Android system Back pops WebView history. Subscribe only while this tab is
  // the visible one AND there is history to pop; otherwise no handler exists at
  // all, so the event keeps its default meaning (leave the app) and a hidden
  // Browser tab can never swallow it.
  useEffect(() => {
    if (Platform.OS !== 'android' || !isActive || !canGoBack) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      webRef.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [isActive, canGoBack]);

  const go = () => {
    const next = normalizeUrl(address);
    setUri(next);
    setAddress(next);
  };

  // Android hands `window.open` / `target="_blank"` to a detached WebView the
  // user never sees. Show those navigations in this single tab instead — but a
  // page-supplied URL only reaches `source` once validated as plain HTTP(S);
  // javascript:/data:/intent: targets are dropped.
  const openWindowInThisTab = (targetUrl: string) => {
    const next = navigableHttpUrl(targetUrl);
    if (!next) return;
    // In-page navigation can leave `uri` unchanged. Updating the same source
    // would do nothing; navigate the existing WebView without discarding history.
    if (next === uri) {
      webRef.current?.injectJavaScript(`window.location.assign(${JSON.stringify(next)});true;`);
    }
    setUri(next);
    setAddress(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <TouchableOpacity
          style={[styles.navBtn, !canGoBack && styles.navBtnDisabled]}
          onPress={() => webRef.current?.goBack()}
          disabled={!canGoBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityState={{ disabled: !canGoBack }}
        >
          <Text style={styles.navBtnText}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navBtn, !canGoForward && styles.navBtnDisabled]}
          onPress={() => webRef.current?.goForward()}
          disabled={!canGoForward}
          accessibilityRole="button"
          accessibilityLabel="Forward"
          accessibilityState={{ disabled: !canGoForward }}
        >
          <Text style={styles.navBtnText}>›</Text>
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
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => webRef.current?.reload()}
          accessibilityRole="button"
          accessibilityLabel="Reload"
        >
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
        // Android also emits load-start for history updates after loading ends.
        onLoadStart={(event) => setLoading(event.nativeEvent.loading)}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={(state) => {
          setAddress(state.url);
          setCanGoBack(state.canGoBack);
          setCanGoForward(state.canGoForward);
        }}
        onOpenWindow={(event) => openWindowInThisTab(event.nativeEvent.targetUrl)}
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
  navBtnDisabled: { opacity: 0.35 },
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
